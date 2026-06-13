# RateShield — Distributed Rate Limiter Sandbox

RateShield is an interactive, full-stack educational sandbox designed to demonstrate and visualize core API rate-limiting algorithms. It runs in a distributed mode using Redis (orchestrated with atomic Lua scripts) and features a seamless, fast fallback to local in-memory storage if Redis is offline.

---

## 🛠️ Repository Architecture & Tech Stack

The workspace is divided into two main components:
- **Backend (`/backend`)**: Built using **Node.js**, **Express**, and **ioredis**. It contains the custom middleware that dynamically applies rate-limiting rules received via headers and executes them atomically.
- **Frontend (`/frontend`)**: Built using **React 19**, **Vite**, and **Tailwind CSS**. It provides a real-time, interactive dashboard that visualizes algorithm states, contains preset testing modes, and has a built-in stress-test simulator.

```text
       ┌──────────────────┐
       │  React Frontend  │
       │ (localhost:5174) │
       └────────┬─────────┘
                │ Proxy /api
                ▼
       ┌──────────────────┐
       │ Express Backend  │
       │ (localhost:3000) │
       └────────┬─────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
 ┌────────────┐   ┌────────────┐
 │Redis ZSETs │   │ In-Memory  │
 │ (Default)  │   │ (Fallback) │
 └────────────┘   └────────────┘
```

---

## 🚀 Quick Start Guide

To run the full stack locally, follow these steps:

### 1. Prerequisite: Redis Server (Optional)
For the distributed rate-limiting features, ensure a local Redis server is running:
```bash
redis-server
```
*Note: If Redis is not running, the backend automatically falls back to In-Memory mode within 1 second.*

### 2. Run the Backend
Navigate to the `/backend` folder, install dependencies, and start the server:
```bash
cd backend
npm install
node server.js
```
The server will run on `http://localhost:3000`.

### 3. Run the Frontend
Navigate to the `/frontend` folder, install dependencies, and start the development server:
```bash
cd ../frontend
npm install
npm run dev
```
The Vite server will start on `http://localhost:5174`. Open this URL in your web browser to play with the sandbox.

---

## 📊 Core Features

- **Four rate-limiting algorithms:** Token Bucket, Leaky Bucket, Fixed Window, and Sliding Window Log.
- **Dynamic Headers Configuration:** The frontend communicates rules (limits, window size, refill/leak rates) dynamically via custom HTTP headers, letting you adjust parameters on the fly.
- **Real-Time Visualizations:** Observe how tokens refill, how water leaks, and how logs slide inside the window in real-time.
- **Stress-Test Spammer:** Trigger high-frequency requests (up to 10 RPS) automatically to stress test and see how rate-limiters block excess traffic (429 status code).
- **One-Click Flush:** Easily reset all rates and clear both Redis database or memory stores with a single click.

For detailed information about each component, refer to:
- 📂 [Backend Implementation Details](file:///c:/Users/vakit/OneDrive/Desktop/ApiRate/backend/README.md)
- 📂 [Frontend Dashboard Details](file:///c:/Users/vakit/OneDrive/Desktop/ApiRate/frontend/README.md)
