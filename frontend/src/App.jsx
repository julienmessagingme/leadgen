import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Pipeline from "./pages/Pipeline";
import Sequences from "./pages/Sequences";
import Settings from "./pages/Settings";
import ColdOutbound from "./pages/ColdOutbound";
import ColdOutreach from "./pages/ColdOutreach";
import HubspotSignals from "./pages/HubspotSignals";
import MessagesDraft from "./pages/MessagesDraft";
import Invitations from "./pages/Invitations";
import EmailTracking from "./pages/EmailTracking";

const queryClient = new QueryClient();

function ProtectedRoute({ children }) {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-500">Chargement...</p>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PublicRoute({ children }) {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-500">Chargement...</p>
      </div>
    );
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipeline"
        element={
          <ProtectedRoute>
            <Pipeline />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sequences"
        element={
          <ProtectedRoute>
            <Sequences />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hubspot-signals"
        element={
          <ProtectedRoute>
            <HubspotSignals />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invitations"
        element={
          <ProtectedRoute>
            <Invitations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/messages-draft"
        element={
          <ProtectedRoute>
            <MessagesDraft />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cold-outbound"
        element={
          <ProtectedRoute>
            <ColdOutbound />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cold-outreach"
        element={
          <ProtectedRoute>
            <ColdOutreach />
          </ProtectedRoute>
        }
      />
      <Route
        path="/email-tracking"
        element={
          <ProtectedRoute>
            <EmailTracking />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
