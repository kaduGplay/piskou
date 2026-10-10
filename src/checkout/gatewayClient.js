// Tokenização do cartão no navegador: o número do cartão nunca passa pelo nosso servidor,
// só o token que o gateway devolve. Ao integrar o gateway, troque o corpo desta função
// pela tokenização do SDK dele. Enquanto isso, gera um token de teste aceito só pelo modo de teste.
export async function tokenizeCard(card) {
  return `tok_test_${card.number.slice(-4)}`
}
