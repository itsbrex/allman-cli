export function validateLocalName(name: string | undefined): asserts name is string {
  if (
    !name ||
    !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,79}$/.test(name) ||
    ["constructor", "prototype", "__proto__"].includes(name)
  )
    throw new Error("Name must be 1–80 letters, digits, spaces, dots, underscores or hyphens");
}
