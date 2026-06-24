// src/components/Spin.jsx — small inline spinner + label, reused on buttons/cards.
export default function Spin({ children }) {
  return (
    <span className="working"><span className="spinner" /> {children}</span>
  );
}
