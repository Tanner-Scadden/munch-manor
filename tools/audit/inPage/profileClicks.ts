export const lastMessageTags = () =>
  '__messages' in window ? window.__messages.slice(-8).join(', ') : '(live)'
