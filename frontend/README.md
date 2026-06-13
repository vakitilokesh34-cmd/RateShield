# RateShield — Frontend Dashboard

This is the React + Vite frontend dashboard for the RateShield Sandbox. It provides a visual interface to interact with, configure, and monitor different rate-limiting algorithms in real-time.

---

## 🎨 Design & Layout

The dashboard is designed with a premium, high-fidelity dark interface using Harmony gold accents and features:
*   **Left Column (Control Panel):**
    *   **Algorithm Selector:** Toggle between Token Bucket, Leaky Bucket, Fixed Window, and Sliding Window Log with descriptive taglines.
    *   **Configuration Sliders:** Adjust parameters like request limit, window size, capacity, and manual/auto refill or leak rates.
    *   **Preset Buttons:** Instantly apply rate limiter profiles:
        *   `Balanced`: Standard limits with auto-refill.
        *   `Strict`: Tight limits, slow refill.
        *   `DDoS Test`: Fast rates for simulation.
    *   **Stress Test Suite:** Start a background request spammer that sends up to 10 requests per second to simulate traffic spikes.
*   **Right Column (Visualizations & Logs):**
    *   **Request Trigger:** Manually trigger public (`/api/`) or protected (`/api/data`) requests.
    *   **Real-Time State Visualization:**
        *   *Token Bucket:* Progress bar representing available tokens.
        *   *Leaky Bucket:* Fluid bar representing current water level.
        *   *Fixed Window:* Dynamic countdown indicator until window reset.
        *   *Sliding Window:* Interactive timeline plotting active request timestamps in the rolling window.
    *   **Metrics Grid:** Displays live statistics including Total requests, Successes, Blocked (429s), and Success Rate percentage.
    *   **Interactive Request Log:** A scrollable console showing history, timestamps, status codes, and remaining limits of past requests.

---

## ⚙️ Vite Proxy Setup

The frontend development server utilizes a proxy configuration inside [vite.config.js](file:///c:/Users/vakit/OneDrive/Desktop/ApiRate/frontend/vite.config.js) to resolve CORS issues during development. It routes all `/api` traffic to the backend server seamlessly:

```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
}
```

This maps `/api/*` requests triggered in [App.jsx](file:///c:/Users/vakit/OneDrive/Desktop/ApiRate/frontend/src/App.jsx) (e.g. `fetch('/api/data')`) directly to the backend running on `localhost:3000`.

---

## 🏃 Setup & Execution

### 1. Install Dependencies
Ensure you have Node.js installed, then run:
```bash
npm install
```

### 2. Start the Vite Development Server
```bash
npm run dev
```

The application will start on `http://localhost:5174` (or next available port). Open this URL in your web browser.

### 3. Build for Production
To bundle the frontend application for production:
```bash
npm run build
```
This produces optimized production assets inside the `/dist` directory.
