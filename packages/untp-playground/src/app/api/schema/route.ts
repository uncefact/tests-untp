import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "No schema URL provided" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(url);
    const schema = await response.json();
    return NextResponse.json(schema);
  } catch (error) {
    console.log("Error fetching schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch schema" },
      { status: 500 }
    );
  }
}
