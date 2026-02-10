# 사진이야기 (Photo Story) - App Module Codebase

## 📌 프로젝트 개요

이 저장소는 풀스택 블로그 플랫폼 **blogPion79**의 핵심 기능 모듈인 **'사진이야기(Photo Story)'** 앱의 소스 코드만을 추출한 것입니다.
거대한 모노레포 프로젝트에서 특정 도메인(앱)이 어떻게 **독립적인 모듈**로 설계되고 구현되었는지를 보여주기 위한 포트폴리오 및 레퍼런스 용도입니다.

**사진이야기**는 500px와 유사한 사용자 경험을 제공하는 **고품질 사진 전시 및 소셜 애플리케이션**입니다.

## 📂 파일 구조 설명

이 코드는 실제 프로덕션 환경에서 작동하는 코드의 일부를 발췌한 것입니다.

```text
Photo_story/
├── backend/
│   ├── routes.ts          # 백엔드 핵심 로직 (Express 라우터, Prisma 트랜잭션 등)
│   └── schema.prisma      # 데이터 모델링 (PostgreSQL 스키마)
├── frontend/
│   ├── PhotoStoryPageClient.tsx  # 프론트엔드 메인 UI (Next.js 클라이언트 컴포넌트)
│   └── AuthorizedImage.tsx       # 보안 이미지 서빙 처리 컴포넌트
└── docs/
    └── development-plan.md       # 초기 기획 및 아키텍처 설계 문서
```

## ✨ 주요 특징 및 기술적 구현

### 1. 멀티 인스턴스 아키텍처 (Multi-instance Architecture)

블로그 내에 '여행', '가족', '포트폴리오' 등 **여러 개의 독립된 사진 앱을 설치**할 수 있도록 설계되었습니다.

- **Backend**: `routes.ts`에서 `slug` 파라미터를 통해 동적으로 앱 인스턴스를 식별하고 권한을 제어합니다.
- **DB**: `AppInstance` 모델을 중심으로 게시물과 설정이 격리됩니다.

### 2. 보안 이미지 서빙 (Secure Image Serving)

업로드된 원본 이미지는 외부 접근이 차단되어 있으며, 오직 권한이 있는 사용자만 열람할 수 있습니다.

- **Auth Flow**: 이미지를 `<img>` 태그로 직접 요청하는 대신, `AuthorizedImage` 컴포넌트가 JWT 토큰을 헤더에 실어 백엔드 API (`/api/apps/:slug/image/:mediaId`)로 요청합니다.
- **Backend Optimization**: 권한 검증 후 Node.js 스트림 또는 Nginx의 `X-Accel-Redirect`를 사용하여 효율적으로 파일을 전송합니다.

### 3. 소셜 인터랙션 (Social Interaction)

사진 감상에 특화된 UI와 소셜 기능을 제공합니다.

- **Masonry Grid**: 다양한 비율의 사진을 벽돌 쌓기 형태로 아름답게 배치.
- **Photo Essay**: 사진 위에 오버레이 되는 짧은 글(수필, 시) 기능을 통해 감성적인 스토리텔링 지원.
- **Drag & Drop UI**: 댓글 및 짧은글 창을 드래그하여 사진 감상을 방해하지 않도록 설계.

## 🛠️ 기술 스택

- **Frontend**: TypeScript, React, Next.js (App Router), Tailwind CSS
- **Backend**: Node.js, Express, Prisma ORM
- **Database**: PostgreSQL

## ⚠️ 참고 사항

이 코드는 모노레포(`blogPion79`)의 일부이므로 **단독으로 실행되지 않습니다.**
공통 유틸리티(Logger, Auth Middleware 등)와 환경 설정 파일이 제외되어 있습니다.
전체 아키텍처와 코딩 스타일, 도메인 로직의 구현 방식을 파악하는 용도로 참고해 주시기 바랍니다.
