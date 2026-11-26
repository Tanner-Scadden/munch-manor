export const shareClicks = () =>
  window.__messages.filter(message => message === 'ClickedShareButton').length
