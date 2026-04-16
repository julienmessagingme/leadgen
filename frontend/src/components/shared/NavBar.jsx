import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/sequences", label: "Sequences" },
  { to: "/invitations", label: "🔗 Invitations" },
  { to: "/messages-draft", label: "✉ À valider" },
  { to: "/hubspot-signals", label: "Signaux HubSpot" },
  { to: "/cold-outbound", label: "Cold Outbound" },
  { to: "/cold-outreach", label: "🎯 Troudebal" },
  { to: "/email-tracking", label: "Tracking Emails" },
  { to: "/email-followups", label: "📬 Relances" },
  { to: "/settings", label: "Parametres" },
];

export default function NavBar() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="text-lg font-bold text-gray-800">LeadGen</span>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-100 text-indigo-700"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-600 hover:text-gray-900 bg-gray-100 px-3 py-1.5 rounded-md hover:bg-gray-200"
        >
          Se deconnecter
        </button>
      </div>
    </header>
  );
}
