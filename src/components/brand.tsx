import { PawPrint } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <PawPrint size={22} strokeWidth={1.8} />
      </span>
      <span>
        DogBooker<span className="brand-sub">GLADA HUNDAR. VARJE DAG.</span>
      </span>
    </div>
  );
}
