import { useEffect, useMemo, useRef, useState } from "react";
import "./SnakeBoard.css";
import { Panel } from "./ui/Panel";

export type BoardResultFx = "winner" | "loser" | "draw" | null;

type Props = {
  side: "alpha" | "beta";
  title: string;
  alive: boolean;
  board: number[];
  resultFx?: BoardResultFx;
};

const BOARD_SIZE = 20;

function classForCell(v: number) {
  if (v === 2) return "cell food";
  if (v >= 3 && v <= 7) return "cell snake body";
  if (v >= 8) return "cell snake head";
  return "cell";
}

function findHeadIndex(cells: number[]): number | null {
  const index = cells.findIndex((cell) => cell >= 8);
  return index >= 0 ? index : null;
}

function deriveMoveDirection(
  previousHead: number | null,
  nextHead: number | null
): string {
  if (previousHead == null || nextHead == null) return "--";
  if (previousHead === nextHead) return "Hold";

  const prevX = previousHead % BOARD_SIZE;
  const prevY = Math.floor(previousHead / BOARD_SIZE);
  const nextX = nextHead % BOARD_SIZE;
  const nextY = Math.floor(nextHead / BOARD_SIZE);

  if (nextX === prevX + 1 && nextY === prevY) return "Right";
  if (nextX === prevX - 1 && nextY === prevY) return "Left";
  if (nextX === prevX && nextY === prevY - 1) return "Up";
  if (nextX === prevX && nextY === prevY + 1) return "Down";
  return "--";
}

export function SnakeBoard({
  side,
  title,
  alive,
  board,
  resultFx = null,
}: Props) {
  const [foodBlastIndices, setFoodBlastIndices] = useState<number[]>([]);
  const [moveDirection, setMoveDirection] = useState("--");
  const previousBoardRef = useRef<number[] | null>(null);
  const previousHeadRef = useRef<number | null>(null);
  const blastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const previous = previousBoardRef.current;
    if (previous && previous.length === board.length) {
      const disappearedFood: number[] = [];
      for (let i = 0; i < board.length; i += 1) {
        if (previous[i] === 2 && board[i] !== 2) {
          disappearedFood.push(i);
        }
      }

      if (disappearedFood.length > 0) {
        setFoodBlastIndices(disappearedFood);
        if (blastTimerRef.current) {
          window.clearTimeout(blastTimerRef.current);
        }
        blastTimerRef.current = window.setTimeout(() => {
          setFoodBlastIndices([]);
          blastTimerRef.current = null;
        }, 320);
      }
    }

    previousBoardRef.current = board.slice();

    const nextHead = findHeadIndex(board);
    const direction = deriveMoveDirection(previousHeadRef.current, nextHead);
    if (direction !== "--") {
      setMoveDirection(direction);
    }
    previousHeadRef.current = nextHead;
  }, [board]);

  useEffect(() => {
    return () => {
      if (blastTimerRef.current) {
        window.clearTimeout(blastTimerRef.current);
      }
    };
  }, []);

  const blastIndexSet = useMemo(
    () => new Set<number>(foodBlastIndices),
    [foodBlastIndices]
  );

  const icon = side === "alpha" ? "circle" : "change_history";
  const fxClass = resultFx ? `board-fx board-fx-${resultFx}` : "";
  const sideClass = `board-${side}`;
  return (
    <Panel className={`board-card ${sideClass} ${fxClass}`.trim()}>
      <header className="board-header">
        <h3 className="board-title">
          <span className="material-symbols-outlined board-title-icon" aria-hidden="true">
            {icon}
          </span>
          <span>{title}</span>
        </h3>
        <div className="board-header-meta">
          <span className="board-move-direction">{moveDirection}</span>
          <div className={`pill ${alive ? "alive" : "dead"}`}>
            {alive ? "Alive" : "Dead"}
          </div>
        </div>
      </header>
      <div className="grid" role="img" aria-label={`${title} board`}>
        {board.map((cell, i) => {
          const baseClass = classForCell(cell);
          const blastClass = blastIndexSet.has(i) ? " food-blast" : "";
          return <div key={i} className={`${baseClass}${blastClass}`} />;
        })}
      </div>
    </Panel>
  );
}
