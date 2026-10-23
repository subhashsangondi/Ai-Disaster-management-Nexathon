
import "./App.css";

const incidents = [
  {
    id: "INC-001",
    title: "Landslide near village",
    description: "Three people reported trapped under debris.",
    location: "Village area",
    urgency: "Urgent",
    status: "Pending",
  },
  {
    id: "INC-002",
    title: "Flooding on main road",
    description: "Floodwater is affecting road access.",
    location: "Main road",
    urgency: "High",
    status: "Assigned",
  },
  {
    id: "INC-003",
    title: "Building damage reported",
    description: "A witness reports damage after an earthquake.",
    location: "Residential area",
    urgency: "Medium",
    status: "In Progress",
  },
];

function App() {
  const summary = [
    { label: "Total Incidents", value: 12, icon: "📋" },
    { label: "Urgent Cases", value: 3, icon: "🚨" },
    { label: "In Progress", value: 4, icon: "🛟" },
    { label: "Resolved", value: 5, icon: "✅" },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">🛡️</span>
          <div>
            <h2>RescueGrid AI</h2>
            <p>Disaster Response</p>
          </div>
        </div>

        <nav className="navigation">
          <a className="nav-link active" href="#overview">▦ Dashboard</a>
          <a className="nav-link" href="#incidents">📋 Incidents</a>
          <a className="nav-link" href="#map">📍 Rescue Map</a>
          <a className="nav-link" href="#teams">👥 Rescue Teams</a>
        </nav>

        <div className="sidebar-note">
          <span className="status-dot" />
          <div>
            <strong>Dashboard ready</strong>
            <p>Demo mode enabled</p>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">EMERGENCY OPERATIONS</p>
            <h1>Rescue Dashboard</h1>
            <p className="subtitle">
              Monitor incidents and coordinate rescue operations.
            </p>
          </div>
          <span className="demo-badge">DEMO DATA</span>
        </header>

        <section id="overview" className="summary-grid">
          {summary.map((item) => (
            <article className="summary-card" key={item.label}>
              <div className="summary-top">
                <span>{item.label}</span>
                <span className="summary-icon">{item.icon}</span>
              </div>
              <strong className="summary-value">{item.value}</strong>
              <span className="summary-caption">Sample statistics</span>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article id="map" className="panel map-panel">
            <div className="panel-heading">
              <div>
                <h2>Incident Map</h2>
                <p>Geographic overview of reported emergencies</p>
              </div>
              <span className="coming-soon">Part 2</span>
            </div>

            <div className="map-placeholder">
              <div className="map-road road-one" />
              <div className="map-road road-two" />
              <span className="map-pin pin-one">!</span>
              <span className="map-pin pin-two">!</span>
              <span className="map-pin pin-three">!</span>
              <div className="map-message">
                <span>📍</span>
                <strong>Interactive map coming next</strong>
                <p>Leaflet + OpenStreetMap</p>
              </div>
            </div>

            <div className="map-legend">
              <span><i className="legend-dot urgent" /> Urgent</span>
              <span><i className="legend-dot high" /> High</span>
              <span><i className="legend-dot medium" /> Medium</span>
            </div>
          </article>

          <article className="panel response-panel">
            <div className="panel-heading">
              <div>
                <h2>Response Overview</h2>
                <p>Incident status summary</p>
              </div>
            </div>

            <div className="response-item">
              <div><span>Pending</span><strong>3</strong></div>
              <div className="progress-track">
                <span className="progress-fill pending-fill" />
              </div>
            </div>
            <div className="response-item">
              <div><span>Assigned</span><strong>2</strong></div>
              <div className="progress-track">
                <span className="progress-fill assigned-fill" />
              </div>
            </div>
            <div className="response-item">
              <div><span>In Progress</span><strong>4</strong></div>
              <div className="progress-track">
                <span className="progress-fill progress-fill-active" />
              </div>
            </div>
            <div className="response-item">
              <div><span>Resolved</span><strong>5</strong></div>
              <div className="progress-track">
                <span className="progress-fill resolved-fill" />
              </div>
            </div>

            <div className="human-review">
              <span>ℹ️</span>
              <p>AI recommendations support decisions. Coordinators retain final control.</p>
            </div>
          </article>
        </section>

        <section id="incidents" className="panel incidents-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent Incidents</h2>
              <p>Review reported emergencies and their current status.</p>
            </div>
            <span className="incident-count">{incidents.length} examples</span>
          </div>

          <div className="incident-list">
            {incidents.map((incident) => (
              <article className="incident-row" key={incident.id}>
                <div className="incident-symbol">!</div>
                <div className="incident-details">
                  <div className="incident-title-line">
                    <h3>{incident.title}</h3>
                    <span className={`urgency ${incident.urgency.toLowerCase()}`}>
                      {incident.urgency}
                    </span>
                  </div>
                  <p>{incident.description}</p>
                  <span className="incident-location"> {incident.location}</span>
                </div>
                <span className={`status ${incident.status.toLowerCase().replace(" ", "-")}`}>
                  {incident.status}
                </span>
              </article>
            ))}
          </div>
        </section>

        <footer className="footer">
          <span>RescueGrid AI · Rescue Coordination Platform</span>
          <span>Prototype · Sample data only</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
