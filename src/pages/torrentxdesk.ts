import type { APIRoute } from 'astro';

export const prerender = false;

// Short, shareable link: autcust.com/torrentxdesk → the download page.
export const GET: APIRoute = ({ redirect }) => redirect('/download/torrentxdesk', 301);
