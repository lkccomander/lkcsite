import { TapeItem } from "../types";

interface LiveTapeProps {
  items: TapeItem[];
}

export function LiveTape({ items }: LiveTapeProps) {
  const tape = [...items, ...items];

  return (
    <section className="panel live-tape">
      <div className="live-tape__track">
        {tape.map((item, index) => (
          <span key={`${item.id}-${index}`} className={`tape-item ${item.tone}`}>
            {item.text}
          </span>
        ))}
      </div>
    </section>
  );
}
