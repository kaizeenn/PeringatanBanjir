import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, BrainCircuit, FlaskConical, Cpu, Bell, Users, Settings, ChevronLeft, Droplets } from 'lucide-react';
const links = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/sensor', icon: Activity, label: 'Data Sensor' },
    { to: '/prediction', icon: BrainCircuit, label: 'Prediksi ML' },
    { to: '/model-test', icon: FlaskConical, label: 'Test Model' },
    { to: '/devices', icon: Cpu, label: 'Perangkat' },
    { to: '/notifications', icon: Bell, label: 'Notifikasi' },
    { to: '/users', icon: Users, label: 'User' },
    { to: '/settings', icon: Settings, label: 'Pengaturan' },
];
const Sidebar = ({ collapsed, onToggle }) => {
    return (<aside className={`fixed top-0 left-0 h-screen bg-sidebar border-r border-sidebar-border z-30 flex flex-col transition-all duration-300 ${collapsed ? 'w-[70px]' : 'w-[260px]'}`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border shrink-0">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Droplets className="w-5 h-5 text-primary-foreground"/>
        </div>
        {!collapsed && (<div className="overflow-hidden">
            <h1 className="text-sm font-bold text-card-foreground leading-tight truncate">DataStream Guardian</h1>
            <p className="text-[10px] text-muted-foreground truncate">IoT Monitoring Dashboard</p>
          </div>)}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {links.map(({ to, icon: Icon, label }) => (<NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`} title={label}>
            <Icon className="w-5 h-5 shrink-0"/>
            {!collapsed && <span>{label}</span>}
          </NavLink>))}
      </nav>

      {/* Collapse toggle */}
      <button onClick={onToggle} className="flex items-center justify-center h-12 border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className={`w-5 h-5 transition-transform ${collapsed ? 'rotate-180' : ''}`}/>
      </button>
    </aside>);
};
export default Sidebar;
