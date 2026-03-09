export function buildOriginHeaders(name: string | undefined, secret: string | undefined): HeadersInit {
  if (!name || !secret) {
    return {};
  }

  return {
    [name]: secret
  };
}
