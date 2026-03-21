export default function ActivityCard({ data }) {
  if (!data) return null;

  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Activite recente
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-indigo-600">{data.today}</p>
          <p className="text-sm text-gray-500 mt-1">Aujourd&apos;hui</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-violet-600">{data.week}</p>
          <p className="text-sm text-gray-500 mt-1">Cette semaine</p>
        </div>
      </div>
    </div>
  );
}
