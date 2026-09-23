const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const URL_RE =
  /https?:\/\/[^\s，,、；;）)\]】》"']+/i;

const ID_PATTERNS = [
  /\/share\/(?:video|slides|note)\/(\d+)/i,
  /\/(?:video|note)\/(\d+)/i,
  /[?&](?:modal_id|aweme_id|item_ids)=(?:%5B)?(\d+)/i,
  /"aweme_id"\s*:\s*"?(\d+)"?/i,
  /"itemId"\s*:\s*"?(\d+)"?/i
];


function json(data, status = 200) {
  return Response.json(
    data,
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}


function isDouyinHost(hostname) {
  const h =
    String(hostname || "")
      .toLowerCase();

  return (
    h === "douyin.com" ||
    h.endsWith(".douyin.com") ||
    h === "iesdouyin.com" ||
    h.endsWith(".iesdouyin.com")
  );
}


function extractFirstUrl(text) {
  const match =
    String(text || "")
      .match(URL_RE);

  return match
    ? match[0]
    : null;
}


function extractAwemeId(text) {
  const s =
    String(text || "");

  for (const pattern of ID_PATTERNS) {
    const match =
      s.match(pattern);

    if (match) {
      return match[1];
    }
  }

  if (
    /^\d{15,22}$/.test(
      s.trim()
    )
  ) {
    return s.trim();
  }

  return null;
}


function detectTypeHint(text) {
  const s =
    String(text || "")
      .toLowerCase();

  if (
    s.includes("/share/slides/") ||
    s.includes("/share/note/") ||
    s.includes("/note/")
  ) {
    return "slides";
  }

  if (
    s.includes("/share/video/") ||
    s.includes("/video/")
  ) {
    return "video";
  }

  return null;
}


async function resolveInput(rawInput) {
  const input =
    String(rawInput || "")
      .trim();

  if (!input) {
    throw new Error(
      "請貼上抖音分享文字或鏈接"
    );
  }

  const firstUrl =
    extractFirstUrl(input);

  const directId =
    extractAwemeId(input);

  if (
    directId &&
    (
      !firstUrl ||
      !/v\.douyin\.com/i.test(
        firstUrl
      )
    )
  ) {
    return {
      awemeId: directId,
      typeHint:
        detectTypeHint(input),
      finalUrl:
        firstUrl || ""
    };
  }

  if (!firstUrl) {
    if (directId) {
      return {
        awemeId: directId,
        typeHint:
          detectTypeHint(input),
        finalUrl: ""
      };
    }

    throw new Error(
      "找不到抖音鏈接"
    );
  }

  let current;

  try {
    current =
      new URL(firstUrl);

  } catch {
    throw new Error(
      "鏈接格式不正確"
    );
  }

  for (
    let i = 0;
    i < 8;
    i += 1
  ) {

    if (
      !isDouyinHost(
        current.hostname
      )
    ) {
      throw new Error(
        "只支援 douyin.com / iesdouyin.com 鏈接"
      );
    }

    const idHere =
      extractAwemeId(
        current.href
      );

    if (idHere) {
      return {
        awemeId: idHere,
        typeHint:
          detectTypeHint(
            current.href
          ),
        finalUrl:
          current.href
      };
    }

    const response =
      await fetch(
        current,
        {
          method: "GET",
          redirect: "manual",

          headers: {
            "User-Agent":
              MOBILE_UA,

            "Accept":
              "text/html,application/xhtml+xml,*/*",

            "Accept-Language":
              "zh-CN,zh;q=0.9,en;q=0.7",

            "Referer":
              "https://www.douyin.com/"
          }
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
        break;
      }

      current =
        new URL(
          location,
          current
        );

      continue;
    }

    const html =
      await response.text();

    const idFromHtml =
      extractAwemeId(
        html
      );

    if (idFromHtml) {
      return {
        awemeId:
          idFromHtml,

        typeHint:
          detectTypeHint(
            current.href +
            " " +
            html
          ),

        finalUrl:
          current.href
      };
    }

    break;
  }

  throw new Error(
    "無法從這條分享鏈接取得作品 ID"
  );
}


function scanBalancedObject(
  text,
  start
) {
  let depth = 0;

  let inString =
    false;

  let escaped =
    false;

  for (
    let i = start;
    i < text.length;
    i += 1
  ) {
    const ch =
      text[i];

    if (inString) {

      if (escaped) {
        escaped =
          false;

      } else if (
        ch === "\\"
      ) {
        escaped =
          true;

      } else if (
        ch === '"'
      ) {
        inString =
          false;
      }

      continue;
    }

    if (
      ch === '"'
    ) {
      inString =
        true;

      continue;
    }

    if (
      ch === "{"
    ) {
      depth += 1;
    }

    if (
      ch === "}"
    ) {
      depth -= 1;
    }

    if (
      depth === 0
    ) {
      return text.slice(
        start,
        i + 1
      );
    }
  }

  return null;
}


function extractRouterData(html) {

  for (
    const marker
    of [
      "window._ROUTER_DATA",
      "_ROUTER_DATA"
    ]
  ) {

    const markerIndex =
      html.indexOf(
        marker
      );

    if (
      markerIndex < 0
    ) {
      continue;
    }

    const equalIndex =
      html.indexOf(
        "=",
        markerIndex
      );

    if (
      equalIndex < 0
    ) {
      continue;
    }

    const objectStart =
      html.indexOf(
        "{",
        equalIndex
      );

    if (
      objectStart < 0
    ) {
      continue;
    }

    const raw =
      scanBalancedObject(
        html,
        objectStart
      );

    if (!raw) {
      continue;
    }

    try {
      return JSON.parse(
        raw
      );

    } catch {
      // 繼續嘗試其他結構
    }
  }

  return null;
}


function extractScriptJson(
  html,
  id,
  decode = false
) {

  const escaped =
    id.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const re =
    new RegExp(
      `<script[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`,
      "i"
    );

  const match =
    html.match(re);

  if (!match) {
    return null;
  }

  try {

    const raw =
      decode

        ? decodeURIComponent(
            match[1]
          )

        : match[1];

    return JSON.parse(
      raw
    );

  } catch {
    return null;
  }
}


function findItem(
  node,
  targetId,
  seen = new Set(),
  depth = 0
) {

  if (
    node == null ||
    depth > 45
  ) {
    return null;
  }

  if (
    typeof node ===
    "object"
  ) {

    if (
      seen.has(node)
    ) {
      return null;
    }

    seen.add(node);
  }

  if (
    Array.isArray(node)
  ) {

    for (
      const item
      of node
    ) {

      const found =
        findItem(
          item,
          targetId,
          seen,
          depth + 1
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof node !==
    "object"
  ) {
    return null;
  }

  const id =
    String(
      node.aweme_id ||
      node.awemeId ||
      node.item_id ||
      node.itemId ||
      ""
    );

  const hasMedia =
    Boolean(
      node.video ||
      node.images ||
      node.image_list ||
      node.image_infos ||
      node.image_post_info ||
      node.imagePostInfo
    );

  if (
    hasMedia &&
    (
      !targetId ||
      !id ||
      id ===
        String(targetId)
    )
  ) {
    return node;
  }

  const priorityKeys = [
    "item_list",
    "aweme_list",
    "aweme_detail",
    "aweme",
    "videoInfoRes",
    "loaderData",
    "app",
    "videoDetail"
  ];

  for (
    const key
    of priorityKeys
  ) {

    if (
      key in node
    ) {

      const found =
        findItem(
          node[key],
          targetId,
          seen,
          depth + 1
        );

      if (found) {
        return found;
      }
    }
  }

  for (
    const value
    of Object.values(node)
  ) {

    const found =
      findItem(
        value,
        targetId,
        seen,
        depth + 1
      );

    if (found) {
      return found;
    }
  }

  return null;
}


function pickUrl(
  node,
  preferLast = false
) {

  if (!node) {
    return null;
  }

  if (
    typeof node ===
    "string"
  ) {

    return node.startsWith(
      "http"
    )
      ? node
      : null;
  }

  if (
    Array.isArray(node)
  ) {

    const urls =
      node.filter(
        x =>
          typeof x ===
            "string" &&
          x.startsWith(
            "http"
          )
      );

    if (
      !urls.length
    ) {
      return null;
    }

    const https =
      urls.filter(
        x =>
          x.startsWith(
            "https://"
          )
      );

    const chosen =
      https.length
        ? https
        : urls;

    return preferLast
      ? chosen[
          chosen.length - 1
        ]
      : chosen[0];
  }

  if (
    typeof node ===
    "object"
  ) {

    return (
      pickUrl(
        node.url_list,
        preferLast
      ) ||

      pickUrl(
        node.urlList,
        preferLast
      ) ||

      pickUrl(
        node.urls,
        preferLast
      ) ||

      (
        typeof node.url ===
        "string"

          ? node.url
          : null
      )
    );
  }

  return null;
}


function cleanPlayUrl(url) {

  if (!url) {
    return null;
  }

  return url
    .replace(
      "/playwm/",
      "/play/"
    )
    .replace(
      "playwm",
      "play"
    );
}


function imageArrayFromItem(
  item
) {

  const candidates = [
    item?.image_post_info?.images,
    item?.image_post_info?.image_list,
    item?.imagePostInfo?.images,
    item?.imagePostInfo?.imageList,
    item?.images,
    item?.image_list,
    item?.image_infos,
    item?.original_images
  ];

  return (
    candidates.find(
      x =>
        Array.isArray(x) &&
        x.length
    ) || []
  );
}


function extractImageUrl(
  image
) {

  if (!image) {
    return null;
  }

  return (
    pickUrl(
      image.url_list,
      true
    ) ||

    pickUrl(
      image.urlList,
      true
    ) ||

    pickUrl(
      image.origin_url,
      true
    ) ||

    pickUrl(
      image.originUrl,
      true
    ) ||

    pickUrl(
      image.display_image,
      true
    ) ||

    pickUrl(
      image.displayImage,
      true
    ) ||

    pickUrl(
      image,
      true
    )
  );
}


function extractCover(item) {

  const video =
    item?.video || {};

  return (
    pickUrl(
      video.origin_cover ||
      video.originCover,
      true
    ) ||

    pickUrl(
      video.cover,
      true
    ) ||

    pickUrl(
      video.dynamic_cover ||
      video.dynamicCover,
      true
    ) ||

    null
  );
}


function extractVideo(item) {

  const video =
    item?.video || {};

  const candidates =
    [];

  const bitRates =
    video.bit_rate ||
    video.bitRate ||
    video.bit_rate_list ||
    video.bitRateList ||
    [];

  if (
    Array.isArray(
      bitRates
    )
  ) {

    for (
      const entry
      of bitRates
    ) {

      const addr =
        entry?.play_addr ||
        entry?.playAddr ||
        entry?.play_addr_h264 ||
        entry?.playAddrH264 ||
        entry?.download_addr ||
        entry?.downloadAddr;

      const url =
        cleanPlayUrl(
          pickUrl(
            addr,
            true
          )
        );

      if (!url) {
        continue;
      }

      candidates.push(
        {
          url,

          width:
            Number(
              addr?.width ||
              entry?.width ||
              video?.width ||
              0
            ),

          height:
            Number(
              addr?.height ||
              entry?.height ||
              video?.height ||
              0
            ),

          bitrate:
            Number(
              entry?.bit_rate ||
              entry?.bitRate ||
              0
            ),

          size:
            Number(
              entry?.data_size ||
              entry?.dataSize ||
              0
            )
        }
      );
    }
  }

  for (
    const addr
    of [
      video.play_addr_h264,
      video.playAddrH264,
      video.play_addr,
      video.playAddr,
      video.download_addr,
      video.downloadAddr
    ]
  ) {

    const url =
      cleanPlayUrl(
        pickUrl(
          addr,
          true
        )
      );

    if (!url) {
      continue;
    }

    candidates.push(
      {
        url,

        width:
          Number(
            addr?.width ||
            video?.width ||
            0
          ),

        height:
          Number(
            addr?.height ||
            video?.height ||
            0
          ),

        bitrate:
          0,

        size:
          Number(
            addr?.data_size ||
            addr?.dataSize ||
            0
          )
      }
    );
  }

  if (
    !candidates.length
  ) {
    return null;
  }

  const deduped =
    [
      ...new Map(
        candidates.map(
          x => [
            x.url,
            x
          ]
        )
      ).values()
    ];

  deduped.sort(
    (
      a,
      b
    ) => {

      const areaA =
        a.width *
        a.height;

      const areaB =
        b.width *
        b.height;

      if (
        areaA !== areaB
      ) {
        return (
          areaB -
          areaA
        );
      }

      if (
        a.bitrate !==
        b.bitrate
      ) {
        return (
          b.bitrate -
          a.bitrate
        );
      }

      return (
        b.size -
        a.size
      );
    }
  );

  return deduped[0];
}


function buildResult(
  item,
  awemeId,
  source
) {

  const imageNodes =
    imageArrayFromItem(
      item
    );

  const images =
    imageNodes
      .map(
        (
          image,
          index
        ) => {

          const url =
            extractImageUrl(
              image
            );

          if (!url) {
            return null;
          }

          return {
            type:
              "photo",

            label:
              `圖片 ${index + 1}`,

            url,

            preview:
              url,

            width:
              Number(
                image?.width ||
                0
              ) || null,

            height:
              Number(
                image?.height ||
                0
              ) || null,

            format:
              "jpg"
          };
        }
      )
      .filter(Boolean);

  const authorObj =
    item?.author ||
    item?.authorInfo ||
    {};

  const author =
    authorObj.nickname ||
    authorObj.name ||
    authorObj.unique_id ||
    authorObj.uniqueId ||
    "";

  const desc =
    String(
      item?.desc ||
      item?.caption ||
      item?.title ||
      ""
    ).trim();

  const cover =
    extractCover(
      item
    );

  if (
    images.length
  ) {

    return {
      ok: true,

      post: {
        id:
          String(
            item?.aweme_id ||
            item?.awemeId ||
            awemeId
          ),

        type:
          "images",

        author,
        desc,

        cover:
          images[0]?.preview ||
          cover,

        source
      },

      media:
        images
    };
  }

  const bestVideo =
    extractVideo(
      item
    );

  if (
    !bestVideo?.url
  ) {

    throw new Error(
      "已找到作品資料，但沒有取得可下載影片地址"
    );
  }

  return {
    ok: true,

    post: {
      id:
        String(
          item?.aweme_id ||
          item?.awemeId ||
          awemeId
        ),

      type:
        "video",

      author,
      desc,
      cover,
      source
    },

    media: [
      {
        type:
          "video",

        label:
          "影片",

        url:
          bestVideo.url,

        preview:
          cover,

        width:
          bestVideo.width ||
          null,

        height:
          bestVideo.height ||
          null,

        bitrate:
          bestVideo.bitrate ||
          null,

        format:
          "mp4",

        quality:
          "最高可用畫質"
      }
    ]
  };
}


/*
 * 2026 版主路徑：
 *
 * 普通影片直接請求抖音移動端 Feed。
 *
 * 比單純依賴 share/video HTML
 * 穩定很多。
 */
async function fetchFeedItem(
  awemeId
) {

  const endpoints = [
    "https://api5-normal-c-hl.amemv.com/" +
      "aweme/v1/feed/" +
      "?aweme_id=" +
      encodeURIComponent(
        awemeId
      ) +
      "&aid=1128",

    "https://aweme.snssdk.com/" +
      "aweme/v1/feed/" +
      "?aweme_id=" +
      encodeURIComponent(
        awemeId
      ) +
      "&aid=1128"
  ];

  const diagnostics =
    [];

  for (
    const endpoint
    of endpoints
  ) {

    try {

      const response =
        await fetch(
          endpoint,
          {
            headers: {
              "User-Agent":
                MOBILE_UA,

              "Accept":
                "application/json",

              "Accept-Language":
                "zh-CN,zh;q=0.9",

              "Referer":
                "https://www.douyin.com/"
            },

            redirect:
              "follow"
          }
        );

      diagnostics.push(
        `feed:${response.status}`
      );

      if (
        !response.ok
      ) {
        continue;
      }

      const data =
        await response
          .json()
          .catch(
            () => null
          );

      if (!data) {
        continue;
      }

      const item =
        findItem(
          data,
          awemeId
        );

      if (item) {

        return {
          item,
          source:
            "mobile-feed",
          diagnostics
        };
      }

    } catch {

      diagnostics.push(
        "feed:ERR"
      );
    }
  }

  return {
    item: null,
    source: null,
    diagnostics
  };
}


/*
 * SSR 後備路徑：
 *
 * 這裡跟舊版最重要的差異有兩個：
 *
 * 1. Android Mobile UA
 * 2. ?from_ssr=1
 */
async function fetchSsrItem(
  awemeId,
  typeHint
) {

  const order =
    typeHint === "slides"

      ? [
          "slides",
          "note",
          "video"
        ]

      : [
          "video",
          "slides",
          "note"
        ];

  const diagnostics =
    [];

  for (
    const kind
    of order
  ) {

    const url =
      `https://www.iesdouyin.com/share/${kind}/${awemeId}/?from_ssr=1`;

    try {

      const response =
        await fetch(
          url,
          {
            headers: {
              "User-Agent":
                MOBILE_UA,

              "Accept":
                "text/html,application/xhtml+xml,*/*",

              "Accept-Language":
                "zh-CN,zh;q=0.9,en;q=0.7",

              "Referer":
                "https://www.douyin.com/"
            },

            redirect:
              "follow"
          }
        );

      const html =
        await response.text();

      /*
       * R = _ROUTER_DATA
       * D = RENDER_DATA
       * U = UNIVERSAL_DATA
       *
       * 如果再失敗，
       * 錯誤訊息會直接告訴我們
       * 抖音到底回了哪種 HTML。
       */
      const markers = [
        html.includes(
          "_ROUTER_DATA"
        )
          ? "R"
          : "-",

        html.includes(
          "RENDER_DATA"
        )
          ? "D"
          : "-",

        html.includes(
          "__UNIVERSAL_DATA_FOR_REHYDRATION__"
        )
          ? "U"
          : "-"
      ].join("");

      diagnostics.push(
        `${kind}:${response.status}:${html.length}:${markers}`
      );

      if (
        !response.ok
      ) {
        continue;
      }

      const dataCandidates = [
        extractRouterData(
          html
        ),

        extractScriptJson(
          html,
          "RENDER_DATA",
          true
        ),

        extractScriptJson(
          html,
          "__UNIVERSAL_DATA_FOR_REHYDRATION__",
          false
        )
      ].filter(Boolean);

      for (
        const data
        of dataCandidates
      ) {

        const item =
          findItem(
            data,
            awemeId
          );

        if (item) {

          return {
            item,

            source:
              `ssr-${kind}`,

            diagnostics
          };
        }
      }

    } catch {

      diagnostics.push(
        `${kind}:ERR`
      );
    }
  }

  return {
    item: null,
    source: null,
    diagnostics
  };
}


export default {

  async fetch(request) {

    if (
      request.method !==
      "GET"
    ) {

      return json(
        {
          ok: false,
          error:
            "Method not allowed"
        },
        405
      );
    }

    try {

      const requestUrl =
        new URL(
          request.url
        );

      const input =
        requestUrl
          .searchParams
          .get("url") ||
        "";

      const resolved =
        await resolveInput(
          input
        );

      const allDiagnostics =
        [];


      /*
       * 普通影片：
       * Feed API → SSR
       */
      if (
        resolved.typeHint !==
        "slides"
      ) {

        const feed =
          await fetchFeedItem(
            resolved.awemeId
          );

        allDiagnostics.push(
          ...feed.diagnostics
        );

        if (feed.item) {

          return json(
            buildResult(
              feed.item,
              resolved.awemeId,
              feed.source
            )
          );
        }
      }


      /*
       * 圖文或 Feed 失敗：
       * SSR
       */
      const ssr =
        await fetchSsrItem(
          resolved.awemeId,
          resolved.typeHint
        );

      allDiagnostics.push(
        ...ssr.diagnostics
      );

      if (ssr.item) {

        return json(
          buildResult(
            ssr.item,
            resolved.awemeId,
            ssr.source
          )
        );
      }


      /*
       * 圖文 SSR 沒資料時，
       * 再試一次 Feed。
       */
      if (
        resolved.typeHint ===
        "slides"
      ) {

        const feed =
          await fetchFeedItem(
            resolved.awemeId
          );

        allDiagnostics.push(
          ...feed.diagnostics
        );

        if (feed.item) {

          return json(
            buildResult(
              feed.item,
              resolved.awemeId,
              feed.source
            )
          );
        }
      }


      throw new Error(
        "作品 ID 已取得，但目前所有資料通道都沒有返回作品資料" +
        `（${allDiagnostics.join(", ")}）`
      );

    } catch (error) {

      return json(
        {
          ok: false,

          error:
            error?.message ||
            "解析失敗，請稍後再試"
        },

        400
      );
    }
  }
};
