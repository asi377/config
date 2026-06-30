export default function Modal({ onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-800">
        {children}
      </div>
      <button
        onClick={onClose}
        className="fixed inset-0 -z-10"
        aria-label="Close modal"
      />
    </div>
  );
}
