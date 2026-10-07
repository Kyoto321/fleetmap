'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useWebSocket } from '@/components/providers/WebSocketProvider'
import { throttle } from '@/lib/utils'
import { optimizeRouteAction } from '@/app/(dashboard)/jobs/actions'

const rawToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
const isMapboxTokenValid = 
  rawToken && 
  rawToken !== 'pk.your_mapbox_token_here' && 
  rawToken.trim() !== ''

// Monkey-patch fetch to block Mapbox telemetry and session tracking requests when using a dummy token
if (typeof window !== 'undefined' && !isMapboxTokenValid) {
  const originalFetch = window.fetch
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url)
    if (url && (url.includes('events.mapbox.com') || url.includes('map-sessions'))) {
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
    }
    return originalFetch(input, init)
  }
}

mapboxgl.accessToken = isMapboxTokenValid ? rawToken : 'pk.dummy'

const VEHICLE_SOURCE = 'vehicles'
const VEHICLE_LAYER  = 'vehicles-layer'
const ROUTE_SOURCE   = 'optimized-route'
const ROUTE_LAYER    = 'optimized-route-layer'

const THROTTLE_MS = 500

interface InitialVehicle {
  id:        string
  latitude:  number
  longitude: number
  status:    string
  registration: string
  assigned_driver_id: string | null
  make?: string | null
  model?: string | null
}

interface InitialJob {
  id: string
  title: string
  status: string
  driver_id: string | null
  scheduled_at: string | null
  delivery_address?: {
    street: string
    city: string
    latitude: number
    longitude: number
  } | null
}

interface Driver {
  id: string
  full_name: string
  email: string
}

interface FleetMapProps {
  initialVehicles?: InitialVehicle[]
  initialJobs?: InitialJob[]
  drivers?: Driver[]
}

export default function FleetMap({ initialVehicles = [], initialJobs = [], drivers = [] }: FleetMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef          = useRef<mapboxgl.Map | null>(null)
  const vehicleDataRef  = useRef<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  })

  const { vehiclePositions, isConnected } = useWebSocket()

  // Route Optimizer States
  const [selectedDriverId, setSelectedDriverId] = useState<string>('')
  const [activeJobs, setActiveJobs] = useState<InitialJob[]>([])
  const [optimizedSequence, setOptimizedSequence] = useState<InitialJob[]>([])
  const [routeStats, setRouteStats] = useState<{ distance: number; timeSaved: number } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  // Find active driver accounts who have assigned tasks
  const activeDrivers = drivers.filter(d => 
    initialJobs.some(j => j.driver_id === d.id && j.status !== 'completed' && j.status !== 'failed')
  )

  // ── Calculate Distance Helper (Haversine) ───────────────────────────────
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371 // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // ── Route Optimization Algorithm (Nearest Neighbor TSP) ──────────────────
  const solveTSP = useCallback((startLat: number, startLon: number, jobsList: InitialJob[]) => {
    if (jobsList.length === 0) return { sequence: [], totalDistance: 0 }

    const unvisited = [...jobsList]
    const sequence: InitialJob[] = []
    let currentLat = startLat
    let currentLon = startLon
    let totalDistance = 0

    while (unvisited.length > 0) {
      let nearestIdx = -1
      let minDistance = Infinity

      for (let i = 0; i < unvisited.length; i++) {
        const addr = unvisited[i].delivery_address
        if (!addr) continue
        const dist = calculateDistance(currentLat, currentLon, addr.latitude, addr.longitude)
        if (dist < minDistance) {
          minDistance = dist
          nearestIdx = i
        }
      }

      if (nearestIdx === -1) break

      const nextJob = unvisited.splice(nearestIdx, 1)[0]
      sequence.push(nextJob)
      totalDistance += minDistance
      currentLat = nextJob.delivery_address!.latitude
      currentLon = nextJob.delivery_address!.longitude
    }

    return { sequence, totalDistance }
  }, [])

  // ── Initialize Mapbox ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: isMapboxTokenValid 
        ? 'mapbox://styles/mapbox/light-v11' 
        : {
            version: 8,
            sources: {
              'osm-raster': {
                type: 'raster',
                tiles: [
                  'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                  'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                  'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors'
              }
            },
            layers: [
              {
                id: 'osm-raster-layer',
                type: 'raster',
                source: 'osm-raster',
                minzoom: 0,
                maxzoom: 19
              }
            ],
            glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
          },
      center: [-0.1278, 51.5074],  // Default: London
      zoom: 10,
      antialias: true,
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.addControl(new mapboxgl.ScaleControl(), 'bottom-left')

    map.on('load', () => {
      vehicleDataRef.current.features = initialVehicles.map(vehicleToFeature)

      map.addSource(VEHICLE_SOURCE, {
        type: 'geojson',
        data: vehicleDataRef.current,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 50,
      })

      // Clusters
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: VEHICLE_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#3B82F6', 10, '#8B5CF6', 30, '#EF4444'],
          'circle-radius': ['step', ['get', 'point_count'], 18, 10, 26, 30, 34],
          'circle-opacity': 0.85,
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: VEHICLE_SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': isMapboxTokenValid
            ? ['DIN Offc Pro Medium', 'Arial Unicode MS Bold']
            : ['Open Sans Regular', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      })

      // Vehicles Layer
      map.addLayer({
        id: VEHICLE_LAYER,
        type: 'circle',
        source: VEHICLE_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'match', ['get', 'status'],
            'en_route',    '#3B82F6',
            'idle',        '#10B981',
            'maintenance', '#F59E0B',
            'offline',     '#6B7280',
            '#3B82F6',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      })

      // Route Source and Layer for Optimization path
      map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      })

      map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#8B5CF6',
          'line-width': 4.5,
          'line-opacity': 0.8,
          'line-dasharray': [1, 1.5],
        },
      }, VEHICLE_LAYER) // Render line string underneath vehicles

      // Popup on click
      map.on('click', VEHICLE_LAYER, (e) => {
        const feature = e.features?.[0]
        if (!feature || feature.geometry.type !== 'Point') return
        const { registration, status, speed } = feature.properties ?? {}
        new mapboxgl.Popup({ offset: 16 })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(`
            <div class="font-sans text-xs min-w-[150px]">
              <div class="font-bold text-slate-800 border-b border-slate-100 pb-1.5 mb-1.5 uppercase tracking-wide">
                ${registration ?? 'Unknown'}
              </div>
              <div class="flex flex-col gap-1.5 text-slate-500">
                <div class="flex justify-between gap-3">
                  <span>Status</span>
                  <span class="font-semibold text-blue-600 capitalize">${status}</span>
                </div>
                <div class="flex justify-between gap-3">
                  <span>Speed</span>
                  <span class="font-semibold text-slate-700">${Number(speed ?? 0).toFixed(1)} km/h</span>
                </div>
              </div>
            </div>
          `)
          .addTo(map)
      })

      map.on('mouseenter', VEHICLE_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', VEHICLE_LAYER, () => { map.getCanvas().style.cursor = '' })
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [initialVehicles])

  // ── Throttled position updater ────────────────────────────────────────────
  const updateMap = useCallback(
    throttle(() => {
      const map = mapRef.current
      if (!map || !map.isStyleLoaded()) return
      const source = map.getSource(VEHICLE_SOURCE) as mapboxgl.GeoJSONSource | undefined
      source?.setData(vehicleDataRef.current)
    }, THROTTLE_MS),
    []
  )

  // ── Sync WebSocket position updates to GeoJSON data ───────────────────────
  useEffect(() => {
    vehiclePositions.forEach((pos, vehicleId) => {
      const idx = vehicleDataRef.current.features.findIndex(
        (f) => f.properties?.id === vehicleId
      )
      if (idx >= 0) {
        const geom = vehicleDataRef.current.features[idx].geometry
        if (geom.type === 'Point') {
          geom.coordinates = [pos.longitude, pos.latitude]
          vehicleDataRef.current.features[idx].properties!.speed = pos.speed
        }
      } else {
        vehicleDataRef.current.features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [pos.longitude, pos.latitude] },
          properties: { id: vehicleId, speed: pos.speed, status: 'en_route' },
        })
      }
    })
    updateMap()
  }, [vehiclePositions, updateMap])

  // ── Trigger Route Optimization logic ──────────────────────────────────────
  const handleOptimize = useCallback((driverId: string) => {
    const map = mapRef.current
    if (!map || !driverId) return

    // Clean existing markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const driverJobs = initialJobs.filter(j => 
      j.driver_id === driverId && j.status !== 'completed' && j.status !== 'failed' && j.delivery_address
    )
    setActiveJobs(driverJobs)

    if (driverJobs.length === 0) {
      setOptimizedSequence([])
      setRouteStats(null)
      const routeSource = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined
      routeSource?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] },
      })
      return
    }

    // Find driver's vehicle position as starting coordinate
    const vehicle = initialVehicles.find(v => v.assigned_driver_id === driverId)
    const startLon = vehicle ? vehicle.longitude : -0.1278
    const startLat = vehicle ? vehicle.latitude : 51.5074

    const result = solveTSP(startLat, startLon, driverJobs)
    setOptimizedSequence(result.sequence)

    // Estimate mock savings
    const currentDist = driverJobs.reduce((acc, job, i) => {
      const addr = job.delivery_address!
      const prev = i === 0 ? { latitude: startLat, longitude: startLon } : driverJobs[i - 1].delivery_address!
      return acc + calculateDistance(prev.latitude, prev.longitude, addr.latitude, addr.longitude)
    }, 0)
    const savings = Math.max(0, currentDist - result.totalDistance)
    setRouteStats({
      distance: result.totalDistance,
      timeSaved: Math.round(savings * 4), // 4 mins per km average
    })

    // Draw route line
    const coords: [number, number][] = [[startLon, startLat]]
    result.sequence.forEach(job => {
      const addr = job.delivery_address!
      coords.push([addr.longitude, addr.latitude])
    })

    const routeSource = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined
    routeSource?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    })

    // Plot numbered HTML markers on the map
    result.sequence.forEach((job, index) => {
      const addr = job.delivery_address!
      const el = document.createElement('div')
      el.className = 'w-7 h-7 rounded-full bg-violet-600 border-2 border-white shadow-lg text-white font-bold text-xs flex items-center justify-center select-none cursor-pointer transform transition-transform hover:scale-110'
      el.innerText = `${index + 1}`

      const marker = new mapboxgl.Marker(el)
        .setLngLat([addr.longitude, addr.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 10 }).setHTML(`
          <div class="font-sans text-xs">
            <div class="font-bold text-slate-800 border-b pb-1 mb-1">STOP #${index + 1}</div>
            <div class="font-semibold text-violet-600">${job.title}</div>
            <div class="text-slate-400 mt-1">${addr.street}</div>
          </div>
        `))
        .addTo(map)

      markersRef.current.push(marker)
    })

    // Fit map bounds to encompass route coordinates
    if (coords.length > 1) {
      const bounds = new mapboxgl.LngLatBounds()
      coords.forEach(c => bounds.extend(c))
      map.fitBounds(bounds, { padding: 50, maxZoom: 14 })
    }

  }, [initialJobs, initialVehicles, solveTSP])

  const handleApplySequence = async () => {
    if (optimizedSequence.length === 0) return
    setIsSaving(true)

    const ids = optimizedSequence.map(j => j.id)
    const res = await optimizeRouteAction(ids)

    setIsSaving(false)
    if (res.success) {
      alert('Optimized route sequence successfully applied to database!')
      window.location.reload()
    } else {
      alert(res.error || 'Failed to apply route sequence')
    }
  }

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full rounded-2xl" />

      {/* Connection status indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-sm border border-slate-200 text-xs font-semibold text-slate-800 shadow-sm pointer-events-none select-none z-10">
        <span className="relative flex h-2 w-2 shrink-0">
          {isConnected && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        </span>
        <span>{isConnected ? 'Live Telemetry' : 'Reconnecting…'}</span>
      </div>

      {/* Route Optimization Control Card */}
      <div className="absolute top-4 right-4 z-10 w-80 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl p-5 flex flex-col gap-4 max-h-[88vh] overflow-y-auto">
        <div className="flex flex-col">
          <span className="text-[10px] text-indigo-600 font-extrabold uppercase tracking-widest leading-none">Route Optimization</span>
          <span className="text-base font-extrabold text-slate-900 mt-1.5">Dispatch Solver</span>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 pl-0.5">Select Fleet Driver</label>
          <select
            value={selectedDriverId}
            onChange={(e) => {
              setSelectedDriverId(e.target.value)
              handleOptimize(e.target.value)
            }}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-semibold focus:outline-none focus:border-indigo-500 transition"
          >
            <option value="">Choose Driver...</option>
            {activeDrivers.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </select>
        </div>

        {selectedDriverId && activeJobs.length > 0 && (
          <div className="flex flex-col gap-3.5 mt-1">
            {/* Optimization Stats Microcard */}
            {routeStats && (
              <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3.5 flex flex-col gap-1 shadow-inner">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-500">Optimized Distance</span>
                  <span className="text-slate-800 font-mono">{routeStats.distance.toFixed(1)} km</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-bold mt-1">
                  <span className="text-emerald-600">Estimated Time Saved</span>
                  <span className="text-emerald-600">~{routeStats.timeSaved} mins</span>
                </div>
              </div>
            )}

            {/* Sequence list */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-0.5">Proposed Stops Sequence</span>
              <div className="flex flex-col gap-1.5 border border-slate-100 rounded-xl bg-white max-h-48 overflow-y-auto p-2">
                {optimizedSequence.map((job, idx) => (
                  <div key={job.id} className="flex items-start gap-2.5 p-1.5 hover:bg-slate-50 rounded-lg transition select-none">
                    <span className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-extrabold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-bold text-slate-800 truncate leading-tight">{job.title}</span>
                      <span className="text-[9px] text-slate-400 truncate mt-0.5">{job.delivery_address?.street}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleApplySequence}
              disabled={isSaving}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl py-2.5 shadow-sm transition border-none cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 mt-1"
            >
              {isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-500 border-t-white animate-spin shrink-0" />
                  Saving Route...
                </>
              ) : 'Apply Optimized Sequence'}
            </button>
          </div>
        )}

        {selectedDriverId && activeJobs.length === 0 && (
          <div className="text-center py-6 text-xs font-semibold text-slate-400 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl">
            No active jobs assigned to this driver.
          </div>
        )}
      </div>

      {/* Mapbox Popup & Custom Marker Styling */}
      <style>{`
        .mapboxgl-popup-content {
          background: #ffffff !important;
          color: #1e293b !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 12px !important;
          padding: 12px 14px !important;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05) !important;
        }
        .mapboxgl-popup-close-button {
          color: #64748b !important;
          font-size: 14px !important;
          padding: 4px 8px !important;
          border-radius: 0 12px 0 0 !important;
          outline: none !important;
        }
        .mapboxgl-popup-close-button:hover {
          background: #f1f5f9 !important;
          color: #0f172a !important;
        }
        .mapboxgl-popup-tip {
          border-bottom-color: #ffffff !important;
          border-top-color: #ffffff !important;
        }
      `}</style>
    </div>
  )
}

function vehicleToFeature(v: InitialVehicle): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
    properties: { 
      id: v.id, 
      registration: v.registration, 
      status: v.status, 
      speed: 0,
      assigned_driver_id: v.assigned_driver_id,
      make: v.make,
      model: v.model,
    },
  }
}
