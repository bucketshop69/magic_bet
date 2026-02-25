import "./SnakeBoard.css";

type Props = {
  title: string;
  score: number;
  alive: boolean;
  board: number[];
};

function classForCell(v: number) {
  if (v === 2) return "cell food";
  if (v >= 3 && v <= 8) return `cell snake s${v}`;
  return "cell";
}

export function SnakeBoard({ title, score, alive, board }: Props) {
  return (
    <section className="board-card">
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
    </section>
  );
}
