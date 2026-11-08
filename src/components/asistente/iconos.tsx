/** Íconos de trazo para el asistente (sin dependencia extra). Heredan el color del texto. */
type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", "aria-hidden": true } as const;

export const Destello = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
);
export const FlechaArriba = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
);
export const IconoTabla = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 10v10" /></svg>
);
export const IconoGrafico = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></svg>
);
export const IconoCodigo = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M9 8l-4 4 4 4M15 8l4 4-4 4" /></svg>
);
export const IconoEscudo = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconoDocumento = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
);
export const IconoMas = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconoAlerta = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);
export const IconoTendencia = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
);
export const IconoPersonas = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></svg>
);
export const IconoCaja = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M21 8l-9-5-9 5 9 5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></svg>
);
export const IconoMapa = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>
);
export const PulgarArriba = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" /><path d="M7 10l4-7a2.5 2.5 0 0 1 2.5 2.8L13 9h5.6a2 2 0 0 1 2 2.4l-1.5 7.6a2 2 0 0 1-2 1.6H7" /></svg>
);
export const PulgarAbajo = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1z" /><path d="M17 14l-4 7a2.5 2.5 0 0 1-2.5-2.8L11 15H5.4a2 2 0 0 1-2-2.4l1.5-7.6a2 2 0 0 1 2-1.6H17" /></svg>
);
export const IconoInforme = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h7M9 16h5" /></svg>
);
export const IconoCheck = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M5 12l5 5 9-10" /></svg>
);
