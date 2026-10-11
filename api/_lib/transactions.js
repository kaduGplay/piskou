import { chatDatabase } from './chat.js'
export async function adminTransactions(req, res, days) {
  if (req.method === 'GET') {
    const status = String(req.query?.status || 'all'),
      offset = Number(req.query?.offset || 0)
    if (
      !['all', 'pending', 'paid', 'failed', 'expired'].includes(status) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      return res.status(400).json({ error: 'Filtro inválido.' })
    return res
      .status(200)
      .json(
        await chatDatabase('rpc/piskou_admin_transactions', {
          p_days: days,
          p_status: status,
          p_offset: offset,
        }),
      )
  }
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método inválido.' })
  const { id, status, note, revision } = req.body || {}
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,120}$/.test(id) ||
    ![null, 'pending', 'paid', 'failed', 'expired'].includes(status) ||
    typeof note !== 'string' ||
    note.length > 500 ||
    !Number.isInteger(revision) ||
    revision < 0
  )
    return res.status(400).json({ error: 'Confira o status e a observação.' })
  const result = await chatDatabase('rpc/piskou_admin_transaction_update', {
    p_id: id,
    p_status: status,
    p_note: note.trim(),
    p_revision: revision,
  })
  if (result.error)
    return res
      .status(
        result.error === 'conflict'
          ? 409
          : result.error === 'not_found'
            ? 404
            : 400,
      )
      .json({
        error:
          result.error === 'conflict'
            ? 'Esta transação mudou em outra aba. Atualize e tente novamente.'
            : 'Transação indisponível ou dados inválidos.',
      })
  return res.status(200).json(result)
}
