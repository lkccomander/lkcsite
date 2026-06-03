import { CycleData } from "../types";

interface ExecutionCycleProps {
  data: CycleData;
}

export function ExecutionCycle({ data }: ExecutionCycleProps) {
  return (
    <section className="panel execution-cycle">
      <div className="execution-header">
        <div>LIVE EXECUTION CYCLE <span className="muted">[CYCLE {data.cycleId}]</span></div>
        <div className="execution-meta">BUDGET {data.budget.toFixed(2)} · ELAPSED {data.elapsedSeconds.toFixed(2)}S</div>
      </div>
      <div className="execution-steps">
        {data.steps.map((step) => (
          <div key={step.id} className={`execution-step ${step.state}`}>
            <div className="execution-step__title">{step.title}</div>
            <div className="execution-step__label">{step.sublabel}</div>
            <div className="execution-step__metric">{step.metric}</div>
          </div>
        ))}
      </div>
      <div className="execution-footer">{data.statusText} · FILL TIME {data.fillTimeSeconds.toFixed(2)}s</div>
    </section>
  );
}
