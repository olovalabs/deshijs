type Choice = "rock" | "paper" | "scissors";

function play(player: Choice): string {
  const choices: Choice[] = ["rock", "paper", "scissors"];
  const computer = choices[Math.floor(Math.random() * 3)];

  if (player === computer) return `Draw! Computer: ${computer}`;

  const win =
    (player === "rock" && computer === "scissors") ||
    (player === "paper" && computer === "rock") ||
    (player === "scissors" && computer === "paper");

  return win
    ? `You win! Computer: ${computer}`
    : `You lose! Computer: ${computer}`;
}

console.log(play("rock"));
//console.log(play("rock"));