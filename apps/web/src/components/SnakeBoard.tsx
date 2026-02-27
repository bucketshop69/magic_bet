import "./SnakeBoard.css";
import { Panel } from "./ui/Panel";

type Props = {
  side: "alpha" | "beta";
  title: string;
  alive: boolean;
  board: number[];
};

function classForCell(v: number) {
  if (v === 2) return "cell food";
  if (v >= 3 && v <= 7) return "cell snake body";
  if (v >= 8) return "cell snake head";
  return "cell";
}

export function SnakeBoard({ side, title, alive, board }: Props) {
  const icon = side === "alpha" ? "circle" : "change_history";
  return (
    <Panel className="board-card">
      <header className="board-header">
        <h3 className="board-title">
          <span className="material-symbols-outlined board-title-icon" aria-hidden="true">
            {icon}
          </span>
          <span>{title}</span>
        </h3>
        <div className={`pill ${alive ? "alive" : "dead"}`}>
          {alive ? "Alive" : "Dead"}
        </div>
      </header>
      <div className="grid" role="img" aria-label={`${title} board`}>
        {board.map((cell, i) => (
          <div key={i} className={classForCell(cell)} />
        ))}
      </div>
    </Panel>
  );
}
