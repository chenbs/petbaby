# 可通过 compose 的 NODE_BASE_IMAGE 指向国内镜像仓库，避免构建时依赖 Docker Hub。
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ARG PNPM_VERSION=10.13.1
ARG NPM_REGISTRY=https://registry.npmjs.org/
# npm registry 镜像兼容普通包下载，但不一定兼容 Corepack 的 /pnpm/<version> 路径；
# 直接用 npm 安装固定版本，避免 Corepack 在国内镜像上返回 404。
RUN npm install --global "pnpm@${PNPM_VERSION}" --registry="${NPM_REGISTRY}" \
  && pnpm config set registry "${NPM_REGISTRY}"

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# font-noto-cjk 供 ffmpeg 的 drawtext 渲染中文字幕：缺字体时 ffmpeg 仍返回 0，
# 但字幕会变成方框或整行消失，属于静默失效。FFMPEG_FONT_FILE 指向下面这个文件。
RUN apk add --no-cache ffmpeg font-noto-cjk tini \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /app ./
# 预建对象存储目录：命名卷首次挂载时会继承这里的属主，否则容器内非 root 用户无法写入。
RUN mkdir -p /app/.data/objects && chown -R nextjs:nodejs /app/.data
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start"]
