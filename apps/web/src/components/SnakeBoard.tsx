import "./SnakeBoard.css";
import { Panel } from "./ui/Panel";

type Props = {
  title: string;
  score: number;
  alive: boolean;
  board: number[];
};

function classForCell(v: number) {
  if (v === 2) return "cell food";
  if (v >= 3 && v <= 7) return "cell snake body";
  if (v >= 8) return "cell snake head";
  return "cell";
}

export function SnakeBoard({ title, score, alive, board }: Props) {
  return (
    <Panel className="board-card">
      <header className="board-header">
        <h3>{title}</h3>
        <div className={`pill ${alive ? "alive" : "dead"}`}>
          {alive ? "Alive" : "Dead"}
        </div>
        <div className="score">Score: {score}</div>
      </header>
      <div className="grid" role="img" aria-label={`${title} board`}>
        {board.map((cell, i) => (
          <div key={i} className={classForCell(cell)} />
        ))}
      </div>
    </Panel>
  );
}
