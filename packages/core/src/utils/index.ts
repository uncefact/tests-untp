/*
  This utility function is designed to convert a string into a path.
  Example usage: 
  convertStringToPath("Issue DLP")
  > "issue-dlp"
*/
export function convertStringToPath(string: string) {
  // Convert to lowercase
  let path = string.toLowerCase();

  // Replace all non-alphanumeric characters with hyphens
  path = path.replace(/[^0-9a-zA-Z]+/g, '-');

  // Remove leading and trailing hyphens
  path = path.replace(/^-+|-+$/g, '');

  return path;
}
