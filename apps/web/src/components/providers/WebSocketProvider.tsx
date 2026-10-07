'use client'

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

interface VehiclePosition {
  vehicle_id: string
  latitude:   number
  longitude:  number
  speed:      number
  timestamp:  string
}

interface WSMessage {
  type: string
  data?: VehiclePosition
  [key: string]: unknown
}

interface WebSocketContextValue {
  isConnected:  boolean
  lastMessage:  WSMessage | null
  vehiclePositions: Map<string, VehiclePosition>
}

const WebSocketContext = createContext<WebSocketContextValue>({
  isConnected: false,
  lastMessage: null,
  vehiclePositions: new Map(),
})

export function WebSocketProvider({
  children,
  token,
}: {
  children: React.ReactNode
  token: string
}) {
  const [isConnected, setIsConnected]   = useState(false)
  const [lastMessage, setLastMessage]   = useState<WSMessage | null>(null)
  const [positions, setPositions]       = useState<Map<string, VehiclePosition>>(new Map())

  const wsRef         = useRef<WebSocket | null>(null)
  const reconnectRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryCount    = useRef(0)
  const maxRetries    = 5

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL}/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      retryCount.current = 0
      // Start heartbeat
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        } else {
          clearInterval(heartbeat)
        }
      }, 30_000)
      ws.addEventListener('close', () => clearInterval(heartbeat))
    }

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)
        setLastMessage(msg)

        if (msg.type === 'vehicle.position' && msg.data) {
          setPositions((prev) => {
            const next = new Map(prev)
            next.set(msg.data!.vehicle_id, msg.data!)
            return next
          })
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = (event) => {
      setIsConnected(false)
      wsRef.current = null

      // Reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s)
      if (retryCount.current < maxRetries && event.code !== 4001 && event.code !== 4002) {
        const delay = Math.min(1000 * 2 ** retryCount.current, 30_000)
        retryCount.current++
        reconnectRef.current = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      wsRef.current?.close(1000, 'Component unmount')
    }
  }, [connect, token])

  return (
    <WebSocketContext.Provider value={{ isConnected, lastMessage, vehiclePositions: positions }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export const useWebSocket = () => useContext(WebSocketContext)
