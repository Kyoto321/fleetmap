# Fleet Platform Login Credentials & Roles Reference

This document provides a comprehensive lookup of all available tenants, subdomains, user roles, permissions, and test login credentials configured for development.

---

## 🔑 Role Matrix & Permissions

The platform supports three distinct roles, each with custom access rules:

| Role | Intended Interface | Access Permissions | Description |
| :--- | :--- | :--- | :--- |
| **Admin** | FleetOps Dashboard (`localhost:3000`) | `["*"]` | Full administrative control over tenants, users, vehicles, and jobs. |
| **Dispatcher** | FleetOps Dashboard (`localhost:3000`) | `["jobs:read", "jobs:write", "vehicles:read", "users:read"]` | Manages operational schedules, registers vehicles, assigns jobs to drivers. |
| **Driver** | Driver PWA (`localhost:3002`) | `["jobs:read", "jobs:update_status"]` | Accesses the mobile driver dashboard, transitions job status, uploads proof of delivery (signatures). |

---

## 🏢 Tenant: ACME Logistics (Subdomain: `acme`)

* **Web URL:** `http://acme.localhost:3000`
* **Driver PWA Subdomain Input:** `acme`
* **Default Password for all accounts:** `demo1234`

| Email Address | Role | Name | Notes |
| :--- | :--- | :--- | :--- |
| `admin@acme.demo` | **Admin** | Admin User | Full system dashboard access. |
| `dispatch@acme.demo` | **Dispatcher** | Sam Dispatcher | Core scheduler dashboard access. |
| `user@acme.demo` | **Dispatcher** | FleetOps User | Newly created dispatcher credential. |
| `driver1@acme.demo` | **Driver** | Alex Driver | PWA access. Pre-assigned to vehicle `Ford Transit (AB12 CDE)`. |
| `driver2@acme.demo` | **Driver** | Jordan Wheels | PWA access. Pre-assigned to vehicle `Mercedes Sprinter (XY99 ZAB)`. |

---

## 🏢 Tenant: Beta Freight Co. (Subdomain: `beta-freight`)

* **Web URL:** `http://beta-freight.localhost:3000`
* **Driver PWA Subdomain Input:** `beta-freight`
* **Default Password for all accounts:** `demo1234`

| Email Address | Role | Name | Notes |
| :--- | :--- | :--- | :--- |
| `admin@beta-freight.demo` | **Admin** | Admin User | Full system dashboard access. |
| `dispatch@beta-freight.demo` | **Dispatcher** | Sam Dispatcher | Core scheduler dashboard access. |
| `user@beta-freight.demo` | **Dispatcher** | Beta Fleet User | Newly created dispatcher credential. |
| `driver1@beta-freight.demo` | **Driver** | Alex Driver | PWA access. Pre-assigned to vehicle `Ford Transit (AB12 CDE)`. |
| `driver2@beta-freight.demo` | **Driver** | Jordan Wheels | PWA access. Pre-assigned to vehicle `Mercedes Sprinter (XY99 ZAB)`. |
