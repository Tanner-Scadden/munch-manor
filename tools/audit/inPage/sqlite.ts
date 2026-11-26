export const opfsFileList = async () => {
  const found: Array<string> = []
  const walk = async (dir: FileSystemDirectoryHandle, path: string) => {
    for await (const [name, handle] of dir.entries()) {
      if (handle instanceof FileSystemDirectoryHandle) {
        await walk(handle, `${path}${name}/`)
      } else {
        found.push(`${path}${name}`)
      }
    }
  }
  await walk(await navigator.storage.getDirectory(), '/')
  return found
}
