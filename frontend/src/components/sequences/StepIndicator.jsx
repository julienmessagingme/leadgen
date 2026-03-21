export const OUTREACH_STEPS = [
  { key: "detected", label: "Detecte", field: "created_at" },
  { key: "invited", label: "Invitation", field: "invitation_sent_at" },
  { key: "connected", label: "Connecte", field: "connected_at" },
  { key: "messaged", label: "Message", field: "message_sent_at" },
  { key: "emailed", label: "Email J+7", field: "email_sent_at" },
  { key: "whatsapped", label: "WhatsApp J+14", field: "whatsapp_sent_at" },
  { key: "replied", label: "Repondu", field: "replied_at" },
];

function computeCurrentStep(lead) {
  for (let i = OUTREACH_STEPS.length - 1; i >= 0; i--) {
    if (lead[OUTREACH_STEPS[i].field]) return i;
  }
  return -1;
}

export default function StepIndicator({ lead }) {
  const currentStep = computeCurrentStep(lead);
  const total = OUTREACH_STEPS.length;
  const stepNumber = currentStep + 1;

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center">
        {OUTREACH_STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                i <= currentStep
                  ? i === currentStep
                    ? "bg-indigo-500 ring-2 ring-indigo-200"
                    : "bg-indigo-500"
                  : "bg-gray-200"
              }`}
              title={step.label}
            />
            {i < total - 1 && (
              <div
                className={`h-0.5 w-4 ${
                  i < currentStep ? "bg-indigo-500" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>
      <span className="text-xs text-gray-500">
        Etape {stepNumber}/{total}
      </span>
    </div>
  );
}
