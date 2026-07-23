import "./PoseInstructionDialog.css";

// Presentation-only: a future voice adapter can consume `messages` here.
const PoseInstructionDialog = ({ pose, phase, messages, onContinue }) => {
  if (!messages?.length) return null;
  return (
    <div className="pose-instruction-dialog__backdrop" role="presentation">
      <section className="pose-instruction-dialog" role="dialog" aria-modal="true" aria-labelledby="pose-instruction-dialog-title">
        <p className="pose-instruction-dialog__eyebrow">{phase === "before" ? "Before recording" : "After recording"}</p>
        <h2 id="pose-instruction-dialog-title">{pose?.name}</h2>
        <ul className="pose-instruction-dialog__messages">{messages.map((message) => <li key={message}>{message}</li>)}</ul>
        <button type="button" className="pose-instruction-dialog__continue" onClick={onContinue}>Continue</button>
      </section>
    </div>
  );
};

export default PoseInstructionDialog;
