// Keep local plan notices attached to the response that created them.
// Server message order remains authoritative, including optimistic messages.
export function chatTimeline(messages, mediaRequests) {
  const ids = new Set(messages.map((message) => message.id))
  const notices = new Map()
  for (const item of mediaRequests) {
    const anchor = ids.has(item.afterMessageId) ? item.afterMessageId : null
    if (!notices.has(anchor)) notices.set(anchor, [])
    notices.get(anchor).push({ type: 'media', item })
  }
  return [
    ...(notices.get(null) || []),
    ...messages.flatMap((message, index) => [
      { type: 'message', message, index },
      ...(notices.get(message.id) || []),
    ]),
  ]
}
