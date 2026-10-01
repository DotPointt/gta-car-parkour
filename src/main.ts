import './style.css';
import { createGame } from './game/game';

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const play = document.getElementById('btn-play') as HTMLButtonElement;
  play.disabled = true;
  try {
    const game = await createGame(canvas);
    if (import.meta.env.DEV) (await import('./dev/devtools')).installDevtools(game);
    game.start();
  } catch (err) {
    console.error(err);
    const loading = document.getElementById('loading')!;
    loading.textContent = 'Ошибка запуска: ' + (err instanceof Error ? err.message : String(err));
    loading.style.color = '#e2362f';
  }
}

main();
