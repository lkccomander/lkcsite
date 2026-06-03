import { useEffect, useMemo, useState } from "react";
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { ForceGraphData, ForceNode } from "../types";
import { formatCurrency, formatPercent } from "../lib/formatters";

interface SimNode extends ForceNode {
  x?: number;
  y?: number;
}

interface ForceGraphPanelProps {
  data: ForceGraphData;
}

const NODE_COLORS: Record<ForceNode["type"], string> = {
  BEARSIGNAL: "#ff3b3b",
  BULLSIGNAL: "#00ff88",
  MEDIANPATH: "#00aaff",
  CATALYST: "#ffaa00",
  CLUSTER: "#9b6bff",
  COLLISION: "#d8d8d0",
};

export function ForceGraphPanel({ data }: ForceGraphPanelProps) {
  const [points, setPoints] = useState<SimNode[]>([]);
  const [hovered, setHovered] = useState<SimNode | null>(null);

  const links = useMemo(
    () =>
      data.links.map((link) => ({
        ...link,
        source: link.source,
        target: link.target,
      })),
    [data.links],
  );

  useEffect(() => {
    const nodes = data.nodes.map((node) => ({ ...node, x: 320 + node.xBias, y: 160 + node.yBias }));
    const simulation = forceSimulation(nodes as SimNode[])
      .force("charge", forceManyBody().strength(-18))
      .force("link", forceLink(links).id((node: { id: string }) => node.id).distance(28).strength(0.22))
      .force("x", forceX(320).strength(0.05))
      .force("y", forceY(180).strength(0.05))
      .force("center", forceCenter(320, 180))
      .alpha(0.55);

    simulation.on("tick", () => {
      setPoints(nodes.map((node) => ({ ...node })));
    });

    return () => {
      simulation.stop();
    };
  }, [data.nodes, links]);

  return (
    <section className="panel force-graph-panel">
      <div className="panel-topline force-header">
        <div>
          <div className="panel-kicker">MiroFish · BTC Graph <span className="muted">FORCE GRAPH · V4.2</span></div>
          <div className="force-subhead">T-5M {formatCurrency(data.referencePrice, 0)} · CI ±{data.ci.toFixed(2)} · PATHS {data.pathCount.toLocaleString()} · TRADE #{data.tradeNumber}</div>
        </div>
        <div className="force-badge-wrap">
          <span className="force-badge positive">▲ {data.streakMinutes} MIN STREAK</span>
          <span className="force-badge warning">PROFIT PACE {formatCurrency(data.profitPace, 0)}/HR</span>
          <span className="force-badge danger">● NEXT TRADE {data.nextTradeSeconds}s</span>
        </div>
      </div>

      <div className="force-content">
        <div className="force-canvas">
          <svg viewBox="0 0 640 360" className="force-svg">
            {Array.from({ length: 9 }, (_, index) => (
              <line key={`fg-x-${index}`} x1={index * 80} x2={index * 80} y1="0" y2="360" className="chart-grid" />
            ))}
            {Array.from({ length: 6 }, (_, index) => (
              <line key={`fg-y-${index}`} x1="0" x2="640" y1={index * 72} y2={index * 72} className="chart-grid" />
            ))}
            {links.map((link, index) => {
              const source = points.find((node) => node.id === link.source);
              const target = points.find((node) => node.id === link.target);
              if (!source || !target) {
                return null;
              }
              return (
                <line
                  key={`${link.source}-${link.target}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={`force-link ${link.tone}`}
                />
              );
            })}
            {points.map((node) => (
              <circle
                key={node.id}
                cx={node.x}
                cy={node.y}
                r={4 + node.weight * 2.4}
                fill={NODE_COLORS[node.type]}
                fillOpacity={0.78}
                stroke={hovered?.id === node.id ? "#ffffff" : "rgba(255,255,255,0.12)"}
                strokeWidth={hovered?.id === node.id ? 1.8 : 0.8}
                className="force-node"
                onMouseEnter={() => setHovered(node)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </svg>
          <div className="force-axis-labels">
            {data.priceLevels.map((level) => (
              <span key={level}>{formatCurrency(level, 0)}</span>
            ))}
          </div>
          <div className="force-sentiment">
            <span className="negative">BEAR {formatPercent((data.bearPaths / (data.bearPaths + data.bullPaths)) * 100, 0)}</span>
            <span className="positive">BULL {formatPercent((data.bullPaths / (data.bearPaths + data.bullPaths)) * 100, 0)}</span>
          </div>
          {hovered ? (
            <div className="force-tooltip">
              <div>{hovered.label}</div>
              <div>{hovered.type}</div>
              <div>Weight {hovered.weight.toFixed(2)}</div>
              <div>{hovered.connections} links</div>
            </div>
          ) : null}
        </div>
        <aside className="force-sidebar">
          <div className="side-stat">
            <span>CONVERGENCE</span>
            <strong>{formatPercent(data.convergence)}</strong>
          </div>
          <div className="side-stat negative">
            <span>BEAR PATHS</span>
            <strong>{data.bearPaths.toLocaleString()}</strong>
          </div>
          <div className="side-stat positive">
            <span>BULL PATHS</span>
            <strong>{data.bullPaths.toLocaleString()}</strong>
          </div>
          <div className="side-stat">
            <span>HUB NODES</span>
            <strong>{data.hubNodes}</strong>
          </div>
          <div className="side-stat negative">
            <span>SIGNAL</span>
            <strong>{data.signal}</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}
