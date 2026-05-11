import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import SensorPage from "./pages/SensorPage";
import PredictionPage from "./pages/PredictionPage";
import ModelTestPage from "./pages/ModelTestPage";
import DevicesPage from "./pages/DevicesPage";
import NotificationsPage from "./pages/NotificationsPage";
import UsersPage from "./pages/UsersPage";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { AuthProvider } from "./features/auth/AuthProvider";
import RequireAuth from "./features/auth/RequireAuth";
const queryClient = new QueryClient();
const App = () => (<QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />}/>
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route path="/" element={<Dashboard />}/>
              <Route path="/sensor" element={<SensorPage />}/>
              <Route path="/prediction" element={<PredictionPage />}/>
              <Route path="/model-test" element={<ModelTestPage />}/>
              <Route path="/devices" element={<DevicesPage />}/>
              <Route path="/notifications" element={<NotificationsPage />}/>
              <Route path="/users" element={<UsersPage />}/>
              <Route path="/settings" element={<SettingsPage />}/>
            </Route>
            <Route path="*" element={<NotFound />}/>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>);
export default App;
