const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";


const EXACT_HOSTS =
  new Set([
    "aweme.snssdk.com",
    "api.amemv.com",
    "www.iesdouyin.com",
    "iesdouyin.com"
  ]);


const ALLOWED_SUFFIXES = [
  ".douyinvod.com",
  ".bytecdn.cn",
  ".douyinpic.com",
  ".douyinstatic.com",
  ".byteimg.com",
  ".ibytedtos.com",
  ".pstatp.com"
];


function allowedHost(
  hostname
) {

  const host =
    hostname.toLowerCase();


  return (
    EXACT_HOSTS.has(
      host
    ) ||

    ALLOWED_SUFFIXES.some(
      suffix =>
        host.endsWith(
          suffix
        )
    )
  );
}


function text(
  message,
  status = 400
) {

  return new Response(
    message,
    {
      status,

      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


function safeFilename(
  name
) {

  const input =
    String(
      name ||
      "douyin-media"
    )
      .replace(
        /[\r\n"]/g,
        ""
      )
      .slice(
        0,
        180
      );


  return (
    input ||
    "douyin-media"
  );
}


function asciiFilename(
  name
) {

  return name
    .replace(
      /[^\x20-\x7E]/g,
      "_"
    )
    .replace(
      /[\\/:*?"<>|]/g,
      "_"
    );
}


function upstreamHeaders(
  request
) {

  const headers =
    new Headers({
      "User-Agent":
        MOBILE_UA,

      "Accept":
        "*/*",

      "Accept-Encoding":
        "identity",

      "Referer":
        "https://www.douyin.com/"
    });


  for (
    const name
    of [
      "range",
      "if-range",
      "if-none-match",
      "if-modified-since"
    ]
  ) {

    const value =
      request.headers.get(
        name
      );


    if (value) {

      headers.set(
        name,
        value
      );
    }
  }


  return headers;
}


async function fetchFollowingRedirects(
  rawUrl,
  request
) {

  let current;


  try {

    current =
      new URL(
        rawUrl
      );

  } catch {

    throw new Error(
      "Invalid media URL"
    );
  }


  for (
    let i = 0;
    i < 7;
    i += 1
  ) {

    if (
      current.protocol !==
        "https:" ||
      !allowedHost(
        current.hostname
      )
    ) {

      throw new Error(
        `Blocked media host: ${current.hostname}`
      );
    }


    const response =
      await fetch(
        current,
        {
          method:
            request.method ===
            "HEAD"

              ? "HEAD"

              : "GET",

          redirect:
            "manual",

          headers:
            upstreamHeaders(
              request
            ),

          cache:
            "no-store"
        }
      );


    if (
      response.status >= 300 &&
      response.status < 400
    ) {

      const location =
        response.headers.get(
          "location"
        );


      if (!location) {

        return response;
      }


      current =
        new URL(
          location,
          current
        );


      continue;
    }


    return response;
  }


  throw new Error(
    "Too many media redirects"
  );
}


function looksLikeBadVideoResponse(
  response,
  filename
) {

  if (
    !/\.mp4$/i.test(
      filename
    )
  ) {

    return false;
  }


  const type =
    (
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();


  return (
    type.includes(
      "text/html"
    ) ||
    type.includes(
      "application/json"
    )
  );
}


async function trySource(
  primary,
  fallback,
  request,
  filename
) {

  let firstError =
    null;


  try {

    const first =
      await fetchFollowingRedirects(
        primary,
        request
      );


    if (
      (
        first.ok ||
        first.status === 206
      ) &&
      !looksLikeBadVideoResponse(
        first,
        filename
      )
    ) {

      return first;
    }


    firstError =
      new Error(
        `Primary source HTTP ${first.status}`
      );


  } catch (error) {

    firstError =
      error;
  }


  if (fallback) {

    try {

      const second =
        await fetchFollowingRedirects(
          fallback,
          request
        );


      if (
        second.ok ||
        second.status === 206
      ) {

        return second;
      }


      throw new Error(
        `Fallback source HTTP ${second.status}`
      );


    } catch (error) {

      throw new Error(
        `${
          firstError?.message ||
          "Primary failed"
        }; ${error.message}`
      );
    }
  }


  throw (
    firstError ||
    new Error(
      "Media source failed"
    )
  );
}


export default {

  async fetch(
    request
  ) {

    if (
      ![
        "GET",
        "HEAD"
      ].includes(
        request.method
      )
    ) {

      return text(
        "Method not allowed",
        405
      );
    }


    const requestUrl =
      new URL(
        request.url
      );


    const primary =
      requestUrl
        .searchParams
        .get(
          "url"
        );


    const fallback =
      requestUrl
        .searchParams
        .get(
          "fallback"
        );


    const filename =
      safeFilename(
        requestUrl
          .searchParams
          .get(
            "filename"
          )
      );


    if (!primary) {

      return text(
        "Missing media URL"
      );
    }


    try {

      const upstream =
        await trySource(
          primary,
          fallback,
          request,
          filename
        );


      const headers =
        new Headers();


      for (
        const name
        of [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "etag",
          "last-modified"
        ]
      ) {

        const value =
          upstream.headers.get(
            name
          );


        if (value) {

          headers.set(
            name,
            value
          );
        }
      }


      if (
        !headers.has(
          "accept-ranges"
        )
      ) {

        headers.set(
          "Accept-Ranges",
          "bytes"
        );
      }


      const ascii =
        asciiFilename(
          filename
        );


      const encoded =
        encodeURIComponent(
          filename
        );


      headers.set(
        "Content-Disposition",

        `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
      );


      headers.set(
        "Cache-Control",
        "private, no-store"
      );


      headers.set(
        "X-Content-Type-Options",
        "nosniff"
      );


      return new Response(
        request.method ===
        "HEAD"

          ? null

          : upstream.body,

        {
          status:
            upstream.status,

          headers
        }
      );


    } catch (error) {

      return text(
        error?.message ||
        "Download failed",

        502
      );
    }
  }
};
