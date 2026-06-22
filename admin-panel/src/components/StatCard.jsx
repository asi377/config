export default function StatCard({ icon: Icon, label, value, sub, color = 'brand' }) {
    const colors = {
        brand: 'bg-brand-500/10 text-brand-400',
        green: 'bg-green-500/10 text-green-400',
        yellow: 'bg-yellow-500/10 text-yellow-400',
        red: 'bg-red-500/10 text-red-400',
        blue: 'bg-blue-500/10 text-blue-400',
    };
    return (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 flex items-start gap-4">
            <div className={`p-3 rounded-lg ${colors[color]}`}>
                <Icon size={20} />
            </div>
            <div className="min-w-0">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className="text-2xl font-bold text-white truncate">{value ?? '—'}</p>
                {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}
