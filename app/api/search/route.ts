import { NextResponse } from "next/server";
import { SearchError, searchWeb } from "@/lib/search";

const MAX_QUERY_LENGTH = 500;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Enter a research question." },
      { status: 400 },
    );
  }

  const query = readQuery(body);

  if (!query) {
    return NextResponse.json(
      { error: "Enter a research question." },
      { status: 400 },
    );
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: "Keep the question under 500 characters." },
      { status: 400 },
    );
  }

  try {
    const result = await searchWeb(query);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SearchError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Search could not be completed. Try again." },
      { status: 500 },
    );
  }
}

function readQuery(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("query" in body)) {
    return null;
  }

  const query = body.query;

  if (typeof query !== "string") {
    return null;
  }

  const trimmed = query.trim();
  return trimmed.length > 0 ? trimmed : null;
}
