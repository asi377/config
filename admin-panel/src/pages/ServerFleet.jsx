import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Server, Plus, Terminal, Copy, Check, ToggleLeft, ToggleRight, Trash2, Search } from 'lucide-react';
import api from '../api/client';

function AddServerModal({ open, onClose }) {
  const [form, setForm] = useState({ name: '', ipAddress: '', port: 443, xrayApiPort: 10085, maxCapacity: 100, region: 'unknown' });
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapScript, setBootstrapScript] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/nodes/servers', form);
      setBootstrapScript(res.data.data.bootstrap);
      toast.success('Server added');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add server');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary-400" />
          Add Server
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Server Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-node-1" required />
            </div>
            <div>
              <label className="label">IP Address</label>
              <input className="input" value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} placeholder="192.168.1.1" required />
            </div>
            <div>
              <label className="label">Port</label>
              <input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 443 })} />
            </div>
            <div>
              <label className="label">Xray API Port</label>
              <input className="input" type="number" value={form.xrayApiPort} onChange={(e) => setForm({ ...form, xrayApiPort: parseInt(e.target.value) || 10085 })} />
            </div>
            <div>
              <label className="label">Max Capacity</label>
              <input className="input" type="number" value={form.maxCapacity} onChange={(e) => setForm({ ...form, maxCapacity: parseInt(e.target.value) || 100 })} />
            </div>
            <div>
              <label className="label">Region</label>
              <input className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="europe" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Server'}
            </button>
          </div>
        </form>

        {bootstrapScript && (
          <div className="border-t border-gray-800 pt-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary-400" />
              Bootstrap Command
            </h3>
            <p className="text-xs text-gray-500 mb-2">Run this on your VPS to connect it to the panel:</p>
            <CopyButton text={bootstrapScript} />
            <pre className="bg-gray-950 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto max-h-48 overflow-y-auto border border-gray-800">
              <code>{bootstrapScript}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 mb-2 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy script'}
    </button>
  );
}

function ServerCard({ server, onToggleSales, onDelete, onUpdated }) {
  const [editingTags, setEditingTags] = useState(false);
  const [tagsInput, setTagsInput] = useState((server.tags || []).join(', '));
  const [dedicated, setDedicated] = useState(server.isDedicated || false);

  const saveTags = async () => {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await api.patch(`/enterprise/servers/${server._id}`, { tags });
      toast.success('Tags updated');
      setEditingTags(false);
    } catch (err) {
      toast.error('Failed to update tags');
    }
  };

  const toggleDedicated = async () => {
    const next = !dedicated;
    try {
      await api.patch(`/enterprise/servers/${server._id}`, { isDedicated: next });
      setDedicated(next);
      toast.success(next ? 'Dedicated mode on' : 'Dedicated mode off');
    } catch (err) {
      toast.error('Failed to toggle dedicated');
    }
  };

  const loadPercent = server.maxCapacity > 0 ? Math.round((server.currentActiveUsers / server.maxCapacity) * 100) : 0;

  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${server.status === 'active' ? 'bg-green-500' : server.status === 'maintenance' ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <div>
            <h3 className="font-semibold">{server.name}</h3>
            <p className="text-xs text-gray-500">{server.ipAddress || server.domain || 'No IP'}</p>
          </div>
        </div>
        <button onClick={() => onDelete(server._id)} className="text-gray-600 hover:text-red-400 transition-colors p-1">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
        <div className="bg-gray-800/50 rounded-lg p-2 text-center">
          <p className="text-gray-500">Port</p>
          <p className="font-mono font-medium">{server.port}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-2 text-center">
          <p className="text-gray-500">Users</p>
          <p className="font-mono font-medium">{server.currentActiveUsers}/{server.maxCapacity}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-2 text-center">
          <p className="text-gray-500">Region</p>
          <p className="font-medium truncate">{server.region}</p>
        </div>
      </div>

      <div className="w-full bg-gray-800 rounded-full h-1.5 mb-4">
        <div
          className={`h-1.5 rounded-full transition-all ${
            loadPercent > 80 ? 'bg-red-500' : loadPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'
          }`}
          style={{ width: `${Math.min(loadPercent, 100)}%` }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Dedicated</span>
          <button onClick={toggleDedicated} className={`transition-colors ${dedicated ? 'text-primary-400' : 'text-gray-600'}`}>
            {dedicated ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Tags</span>
            {editingTags ? (
              <button onClick={saveTags} className="text-xs text-primary-400 hover:text-primary-300">Save</button>
            ) : (
              <button onClick={() => { setEditingTags(true); setTagsInput((server.tags || []).join(', ')); }} className="text-xs text-primary-400 hover:text-primary-300">Edit</button>
            )}
          </div>
          {editingTags ? (
            <input className="input text-xs" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="gaming, vip, eu" autoFocus />
          ) : (
            <div className="flex flex-wrap gap-1">
              {(server.tags || []).length > 0 ? (
                (server.tags || []).map((tag) => (
                  <span key={tag} className="bg-primary-600/20 text-primary-400 border border-primary-600/30 rounded px-2 py-0.5 text-xs">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-xs text-gray-600">No tags</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ServerFleet() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const fetch = useCallback(async () => {
    try {
      const res = await api.get('/nodes');
      setServers(res.data.data.servers || []);
    } catch {
      toast.error('Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this server?')) return;
    try {
      await api.delete(`/nodes/servers/${id}`);
      toast.success('Server deleted');
      fetch();
    } catch {
      toast.error('Delete failed');
    }
  };

  const filtered = servers.filter((s) =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.ipAddress?.includes(search) || s.region?.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6 text-primary-400" />
            Server Fleet
          </h1>
          <p className="text-sm text-gray-400 mt-1">Manage your VPN server nodes</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Add Server
        </button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          className="input pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, IP, or region..."
        />
      </div>

      {servers.length === 0 ? (
        <div className="text-center py-16">
          <Server className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No servers yet</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Your First Server
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((server) => (
            <ServerCard key={server._id} server={server} onDelete={handleDelete} onUpdated={fetch} />
          ))}
        </div>
      )}

      <AddServerModal open={showAdd} onClose={() => { setShowAdd(false); fetch(); }} />
    </div>
  );
}
