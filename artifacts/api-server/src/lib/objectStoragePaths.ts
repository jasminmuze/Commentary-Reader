const GENERATED_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const GENERATED_EPUB_PATH = new RegExp(`^/objects/uploads/${GENERATED_UUID}\\.epub$`);
const GENERATED_AVATAR_PATH = new RegExp(`^/public-objects/avatars/${GENERATED_UUID}$`);

export function isGeneratedEpubObjectPath(objectPath: string): boolean {
  return GENERATED_EPUB_PATH.test(objectPath);
}

export function isGeneratedAvatarObjectPath(objectPath: string): boolean {
  return GENERATED_AVATAR_PATH.test(objectPath);
}