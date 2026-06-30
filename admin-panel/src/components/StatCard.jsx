export default function StatCard({ label, value, icon = '📊' }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-gray-400 text-sm">{label}</div>
          <div className="text-2xl font-bold text-primary-500">{value}</div>
        </div>
        <div className="text-4xl opacity-50">{icon}</div>
      </div>
    </div>
  );
}
