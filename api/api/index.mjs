const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";


const URL_RE =
  /https?:\/\/[^\s，,、；;）)\]】》"']+/i;


const ID_PATTERNS = [
  /\/share\/(?:video|slides|note)\/(\d+)/i,
  /\/(?:video|note)\/(\d+)/i,
  /[?&](?:modal_id|aweme_id|item_ids)=(\d+)/i
];


function json(
  data,
  status = 200
) {

  return Response.json(
    data,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


function isAllowedInputHost(
  hostname
) {

  const h =
    hostname.toLowerCase();


  return (
    h === "douyin.com" ||
    h.endsWith(".douyin.com") ||
    h === "iesdouyin.com" ||
    h.endsWith(".iesdouyin.com")
  );
}


function extractFirstUrl(
  text
) {

  const match =
    String(text || "")
      .match(URL_RE);


  return (
    match
      ? match[0]
      : null
  );
}


function extractAwemeId(
  text
) {

  const s =
    String(text || "");


  for (
    const pattern
    of ID_PATTERNS
  ) {

    const match =
      s.match(pattern);


    if (match) {

      return match[1];
    }
  }


  return null;
}


function detectTypeHint(
  text
) {

  const s =
    String(text || "")
      .toLowerCase();


  if (
    s.includes(
      "/share/note/"
    )
  ) {

    return "note";
  }


  if (
    s.includes(
      "/share/slides/"
    ) ||
    s.includes(
      "/note/"
    )
  ) {

    return "slides";
  }


  if (
    s.includes(
      "/share/video/"
    ) ||
    s.includes(
      "/video/"
    )
  ) {

    return "video";
  }


  return null;
}


async function resolveInput(
  rawInput
) {

  const input =
    String(
      rawInput || ""
    ).trim();


  if (!input) {

    throw new Error(
      "請貼上抖音分享文字或鏈接"
    );
  }


  const directId =
    extractAwemeId(
      input
    );


  if (directId) {

    return {
      awemeId:
        directId,

      typeHint:
        detectTypeHint(
          input
        ),

      finalUrl:
        extractFirstUrl(
          input
        ) || ""
    };
  }


  const firstUrl =
    extractFirstUrl(
      input
    );


  if (!firstUrl) {

    throw new Error(
      "找不到抖音鏈接"
    );
  }


  let current;


  try {

    current =
      new URL(
        firstUrl
      );

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
      !isAllowedInputHost(
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
        awemeId:
          idHere,

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
          method:
            "GET",

          redirect:
            "manual",

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


function scanBalanced(
  text,
  start,
  openChar = "{",
  closeChar = "}"
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
        ch === "\""
      ) {

        inString =
          false;
      }


      continue;
    }


    if (
      ch === "\""
    ) {

      inString =
        true;

      continue;
    }


    if (
      ch === openChar
    ) {

      depth += 1;
    }


    if (
      ch === closeChar
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


function scanJsonStringLiteral(
  text,
  start
) {

  let escaped =
    false;


  for (
    let i = start + 1;
    i < text.length;
    i += 1
  ) {

    const ch =
      text[i];


    if (escaped) {

      escaped =
        false;

    } else if (
      ch === "\\"
    ) {

      escaped =
        true;

    } else if (
      ch === "\""
    ) {

      return text.slice(
        start,
        i + 1
      );
    }
  }


  return null;
}


function extractAssignedJson(
  html,
  marker
) {

  const markerIndex =
    html.indexOf(
      marker
    );


  if (
    markerIndex < 0
  ) {

    return null;
  }


  const equalIndex =
    html.indexOf(
      "=",
      markerIndex
    );


  if (
    equalIndex < 0
  ) {

    return null;
  }


  let i =
    equalIndex + 1;


  while (
    i < html.length &&
    /\s/.test(
      html[i]
    )
  ) {

    i += 1;
  }


  try {

    if (
      html[i] === "{"
    ) {

      const raw =
        scanBalanced(
          html,
          i
        );


      return (
        raw
          ? JSON.parse(raw)
          : null
      );
    }


    if (
      html[i] === "\""
    ) {

      const literal =
        scanJsonStringLiteral(
          html,
          i
        );


      if (!literal) {

        return null;
      }


      const inner =
        JSON.parse(
          literal
        );


      return JSON.parse(
        inner
      );
    }


  } catch {

    return null;
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
    html.match(
      re
    );


  if (!match) {

    return null;
  }


  try {

    const text =
      decode

        ? decodeURIComponent(
            match[1]
          )

        : match[1];


    return JSON.parse(
      text
    );


  } catch {

    return null;
  }
}


function findAwemeItem(
  node,
  targetId,
  seen = new Set(),
  depth = 0
) {

  if (
    depth > 40 ||
    node == null
  ) {

    return null;
  }


  if (
    typeof node ===
    "object"
  ) {

    if (
      seen.has(
        node
      )
    ) {

      return null;
    }


    seen.add(
      node
    );
  }


  if (
    Array.isArray(
      node
    )
  ) {

    for (
      const item
      of node
    ) {

      const found =
        findAwemeItem(
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
      id === String(
        targetId
      )
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
    "loaderData"
  ];


  for (
    const key
    of priorityKeys
  ) {

    if (
      key in node
    ) {

      const found =
        findAwemeItem(
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
    of Object.values(
      node
    )
  ) {

    const found =
      findAwemeItem(
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

    return (
      node.startsWith(
        "http"
      )

        ? node

        : null
    );
  }


  if (
    Array.isArray(
      node
    )
  ) {

    const list =
      node.filter(
        x =>
          typeof x ===
            "string" &&
          x.startsWith(
            "http"
          )
      );


    if (
      !list.length
    ) {

      return null;
    }


    const https =
      list.filter(
        x =>
          x.startsWith(
            "https://"
          )
      );


    const chosen =
      https.length
        ? https
        : list;


    return (
      preferLast

        ? chosen[
            chosen.length - 1
          ]

        : chosen[0]
    );
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
      ) ||

      (
        typeof node.uri ===
          "string" &&
        node.uri.startsWith(
          "http"
        )

          ? node.uri

          : null
      )
    );
  }


  return null;
}


function cleanPlayUrl(
  url
) {

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


function extractVideo(
  item
) {

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
        null;


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


      const width =
        Number(
          addr?.width ||
          entry?.width ||
          video?.width ||
          0
        );


      const height =
        Number(
          addr?.height ||
          entry?.height ||
          video?.height ||
          0
        );


      const bitrate =
        Number(
          entry?.bit_rate ||
          entry?.bitRate ||
          0
        );


      const size =
        Number(
          entry?.data_size ||
          entry?.dataSize ||
          0
        );


      const isH265 =
        Boolean(
          entry?.is_h265 ||
          entry?.isH265 ||
          /h265|hevc/i.test(
            entry?.gear_name ||
            ""
          )
        );


      candidates.push({
        url,
        width,
        height,
        bitrate,
        size,
        isH265
      });
    }
  }


  const ordinary = [
    video.play_addr_h264,
    video.playAddrH264,
    video.play_addr,
    video.playAddr,
    video.download_addr,
    video.downloadAddr
  ];


  for (
    const addr
    of ordinary
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


    candidates.push({
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
        ),

      isH265:
        false
    });
  }


  candidates.sort(
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


      if (
        a.size !==
        b.size
      ) {

        return (
          b.size -
          a.size
        );
      }


      return (
        Number(
          a.isH265
        ) -
        Number(
          b.isH265
        )
      );
    }
  );


  const fallback =
    candidates[0] ||
    null;


  const uri =
    video?.download_addr?.uri ||
    video?.downloadAddr?.uri ||
    video?.play_addr?.uri ||
    video?.playAddr?.uri ||
    video?.uri ||
    null;


  const primary =
    uri

      ? (
          "https://aweme.snssdk.com/" +
          "aweme/v1/play/" +
          "?video_id=" +
          encodeURIComponent(
            uri
          ) +
          "&ratio=default" +
          "&line=0"
        )

      : (
          fallback?.url ||
          null
        );


  return {
    primary,

    fallback:
      (
        fallback?.url &&
        fallback.url !==
          primary
      )

        ? fallback.url

        : null,

    width:
      fallback?.width ||
      Number(
        video?.width ||
        0
      ) ||
      null,

    height:
      fallback?.height ||
      Number(
        video?.height ||
        0
      ) ||
      null,

    bitrate:
      fallback?.bitrate ||
      null
  };
}


function extractCover(
  item
) {

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


function buildResult(
  item,
  awemeId,
  sourceKind
) {

  const imageNodes =
    imageArrayFromItem(
      item
    );


  const images =
    imageNodes
      .map(
        (
          img,
          index
        ) => {

          const url =
            extractImageUrl(
              img
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

            format:
              "jpg"
          };
        }
      )
      .filter(
        Boolean
      );


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
      ok:
        true,

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

        sourceKind
      },

      media:
        images
    };
  }


  const video =
    extractVideo(
      item
    );


  if (
    !video.primary
  ) {

    throw new Error(
      "已找到作品資料，但沒有取得可下載影片地址"
    );
  }


  return {
    ok:
      true,

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
      sourceKind
    },

    media: [
      {
        type:
          "video",

        label:
          "影片",

        url:
          video.primary,

        fallback:
          video.fallback,

        preview:
          cover,

        width:
          video.width,

        height:
          video.height,

        bitrate:
          video.bitrate,

        format:
          "mp4",

        quality:
          "原畫優先"
      }
    ]
  };
}


async function fetchShareItem(
  awemeId,
  typeHint
) {

  const order =
    typeHint

      ? [
          typeHint,

          ...[
            "video",
            "slides",
            "note"
          ].filter(
            x =>
              x !==
              typeHint
          )
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
      `https://www.iesdouyin.com/share/${kind}/${awemeId}/`;


    try {

      const response =
        await fetch(
          url,
          {
            redirect:
              "follow",

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


      diagnostics.push(
        `${kind}:${response.status}`
      );


      if (
        !response.ok
      ) {

        continue;
      }


      const html =
        await response.text();


      const dataCandidates = [
        extractAssignedJson(
          html,
          "window._ROUTER_DATA"
        ),

        extractAssignedJson(
          html,
          "_ROUTER_DATA"
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
      ].filter(
        Boolean
      );


      for (
        const data
        of dataCandidates
      ) {

        const item =
          findAwemeItem(
            data,
            awemeId
          );


        if (item) {

          return {
            item,
            sourceKind:
              kind
          };
        }
      }


    } catch {

      diagnostics.push(
        `${kind}:ERR`
      );
    }
  }


  throw new Error(
    `分享頁沒有返回作品資料（${diagnostics.join(", ")}）`
  );
}


export default {

  async fetch(
    request
  ) {

    if (
      request.method !==
      "GET"
    ) {

      return json(
        {
          ok:
            false,

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
          .get(
            "url"
          ) || "";


      const resolved =
        await resolveInput(
          input
        );


      const {
        item,
        sourceKind
      } =
        await fetchShareItem(
          resolved.awemeId,
          resolved.typeHint
        );


      return json(
        buildResult(
          item,
          resolved.awemeId,
          sourceKind
        )
      );


    } catch (error) {

      return json(
        {
          ok:
            false,

          error:
            error?.message ||
            "解析失敗，請稍後再試"
        },

        400
      );
    }
  }
};
