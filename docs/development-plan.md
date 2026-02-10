# 사진이야기 (Photo Story) 앱 개발 계획서

## 1. 개요

**사진이야기(Photo Story)** 는 500px와 유사한 사용자 경험을 제공하는 블로그 내 사진 전시 애플리케이션입니다. 사용자는 고품질의 사진을 카드 형태로 감상할 수 있으며, 사진에 대한 댓글 및 문학적 글(시, 수필)을 남길 수 있는 소셜 기능을 포함합니다.

본 앱은 **멀티 인스턴스(Multi-instance)** 구조로 설계되어, 하나의 블로그 시스템 내에서 '가족 사진', '여행 사진' 등 서로 다른 주제의 독립된 앱으로 여러 번 설치 및 운영될 수 있습니다.

## 2. 핵심 요구사항 분석 및 대응 전략

| 요구사항                      | 기술적 대응 전략                                                                                                                             |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **다중 설치 (멀티 인스턴스)** | `AppInstance` 모델을 도입하여 앱의 설정, URL Slug, 데이터를 논리적으로 분리합니다.                                                           |
| **격리된 데이터 관리**        | 모든 사진, 댓글, 태그 데이터는 `appInstanceId`를 외래키로 가짐으로써 인스턴스별 데이터 격리를 보장합니다.                                    |
| **보안 (외부 링크 차단)**     | 업로드된 원본 이미지는 웹서버(Nginx)의 직접 접근을 차단하고, 백엔드 API를 통해서만 권한 검증 후 스트리밍(Protected Check) 되도록 구성합니다. |
| **그룹 권한 제어**            | `AppInstance` 레벨에서 접근 허용 그룹을 설정하고, 미들웨어에서 이를 검증합니다.                                                              |
| **다양한 이미지 크기**        | 이미지 업로드 시 또는 요청 시점에 썸네일(S), 중간(M), 원본(L) 리사이징을 처리하거나, 온디맨드 리사이징 파이프라인을 구축합니다.              |
| **짧은글(Essay) 및 댓글**     | 사진 위에 오버레이 되는 형태의 UI를 구현하며, 일반 댓글과 구별되는 '짧은글' 전용 데이터 모델을 구축합니다.                                   |

## 3. 데이터베이스 설계 (Prisma Schema 제안)

기존 스키마에 다음 모델들을 추가하여 앱의 독립성과 확장성을 보장합니다.

```prisma
// 앱 설치 인스턴스 관리
model AppInstance {
  id          String   @id @default(uuid())
  type        AppType  @default(PHOTO_STORY) // 앱 종류 구분 (확장성 고려)
  slug        String   @unique              // URL 경로 (예: 'family-photos')
  name        String                        // 앱 이름 (예: '가족 사진이야기')
  description String?
  config      Json?                         // 앱 별 설정 (허용 그룹, 테마 등)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  photoPosts  PhotoPost[]
  tags        PhotoTag[]
}

enum AppType {
  PHOTO_STORY
  // 추후 다른 앱 추가 가능
}

// 사진 게시물 (기존 Media와 연결)
model PhotoPost {
  id            String   @id @default(uuid())
  appInstanceId String
  appInstance   AppInstance @relation(fields: [appInstanceId], references: [id], onDelete: Cascade)

  mediaId       String
  media         Media    @relation(fields: [mediaId], references: [id])

  title         String?
  description   String?  @db.Text
  location      String?  // 촬영 장소 등 필요시
  takenAt       DateTime? // 촬영일

  // 댓글 및 짧은글
  comments      PhotoComment[]
  essays        PhotoEssay[]

  // 태그 (N:M 관계)
  tags          PhotoTagAssignment[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([appInstanceId])
}

// 독립적인 태그 관리를 위한 모델
model PhotoTag {
  id            String   @id @default(uuid())
  name          String
  appInstanceId String
  appInstance   AppInstance @relation(fields: [appInstanceId], references: [id], onDelete: Cascade)
  posts         PhotoTagAssignment[]

  @@unique([appInstanceId, name]) // 앱 인스턴스 내에서 태그 이름 유일성 보장
}

model PhotoTagAssignment {
  postId    String
  post      PhotoPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  tagId     String
  tag       PhotoTag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([postId, tagId])
}

// 사진 댓글
model PhotoComment {
  id        String   @id @default(uuid())
  content   String
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  postId    String
  post      PhotoPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 사진 위 '짧은글' 데이터
model PhotoEssay {
  id        String   @id @default(uuid())
  title     String?  // 글 제목 (선택)
  content   String   @db.Text
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  postId    String
  post      PhotoPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 4. 시스템 아키텍처 및 구현 상세

### 4.1 백엔드 (Backend)

1.  **App Engine (설치 및 관리)**
    - `/api/apps`: 앱 인스턴스 생성(설치), 수정(이름 변경, 설정 변경), 삭제.
    - 앱 설치 시 `slug` 중복 검사 필수.
2.  **Photo Service**
    - `/api/apps/:slug/posts`: 사진 목록 조회 (페이지네이션, 태그 필터).
    - `/api/apps/:slug/posts/:id`: 상세 조회.
    - `/api/apps/:slug/image/:mediaId`: **보안 이미지 서빙**.
      - 요청 헤더(Cookie/Token)의 사용자 세션 및 `AppInstance`의 허용 그룹 설정(Config)을 확인.
      - 권한 없음 시 403 Forbidden.
      - Query Param으로 `size=thumbnail|medium|large` 지원.
3.  **Interaction Service**
    - 댓글/짧은글 작성 CRUD.

### 4.2 보안 및 이미지 처리

- **직접 접근 차단**: 업로드된 파일이 위치한 디렉토리(`/uploads` 등)는 Nginx 레벨에서 `internal` 설정을 하거나 외부 접근을 막습니다.
- **프록시 서빙**: Node.js 백엔드가 파일을 읽어 Stream Pipe로 응답하거나, Nginx의 `X-Accel-Redirect` 기능을 사용하여 인증은 Node.js가, 전송은 Nginx가 담당하도록 최적화합니다. (성능 고려 시 X-Accel-Redirect 권장)

### 4.3 프론트엔드 (Frontend - User)

1.  **앱 목록 페이지 (`/apps`)**
    - 설치된 모든 `PhotoStory` 인스턴스 카드를 그리드로 표시.
2.  **앱 메인 (`/apps/[slug]`)**
    - **Masonry Grid Layout**: 500px 스타일의 벽돌 쌓기 레이아웃.
    - 각 카드는 썸네일/중간 크기 이미지 로드.
3.  **상세 뷰어 (Modal/Page)**
    - 고해상도 이미지 표시.
    - **우측/하단 패널**: 댓글 리스트.
    - **짧은글 모드**: 버튼 클릭 시 사진 위에 반투명 오버레이로 텍스트(짧은글) 표시.
      - "글 쓰기" 버튼으로 독자가 직접 작성 가능.

### 4.4 어드민 (Admin/Vite)

1.  **앱 관리자**
    - "앱 설치" 버튼 -> 앱 종류 선택(현재는 '사진이야기' 유일) -> 이름 및 슬러그 입력 -> 생성.
    - 설치된 앱 리스트 및 설정(이름 변경, 권한 그룹 설정).
2.  **콘텐츠 관리**
    - 특정 앱 인스턴스 선택 -> 사진 업로드 (기존 Media Library 연동).
    - 사진별 제목, 설명, 초기 태그 입력.

## 5. 개발 단계 (Phases)

### Phase 1: 기반 구축 (Backend & DB)

- **Task 1.1**: Prisma Schema 업데이트 (`AppInstance`, `PhotoPost` 등) 및 마이그레이션.
- **Task 1.2**: 앱 인스턴스 CRUD API 구현.
- **Task 1.3**: 이미지 보안 서빙 API 구현 (`X-Accel-Redirect` 또는 Stream).

### Phase 2: 어드민 기능 개발

- **Task 2.1**: 어드민 사이드바에 'Apps' 메뉴 추가.
- **Task 2.2**: 앱 설치(생성) 및 설정 페이지 구현.
- **Task 2.3**: 앱 내부 사진 업로드 및 관리 UI 구현.

### Phase 3: 프론트엔드 뷰어 개발

- **Task 3.1**: `/apps` 메인 페이지 (앱 목록).
- **Task 3.2**: `/apps/[slug]` 갤러리 페이지 (Masonry Layout).
- **Task 3.3**: 상세 뷰어 및 이미지 최적화 로딩.

### Phase 4: 소셜 기능 (댓글 & 짧은글)

- **Task 4.1**: 사진 댓글 보기/쓰기 컴포넌트 구현.
- **Task 4.2**: 짧은글 작성 에디터 및 오버레이 뷰어 구현.
- **Task 4.3**: 태그 필터링 기능 구현.

### Phase 5: 안정화 및 배포

- **Task 5.1**: 권한 제어 테스트 (그룹별 접근 제한 확인).
- **Task 5.2**: 모바일 반응형 최적화.
- **Task 5.3**: 성능 테스트 및 배포.

---

요구사항을 면밀히 분석하여 현실적이고 확장 가능한 구조의 개발 계획서를 작성했습니다.
특히 '다중 설치(Multi-instance)' 요구사항을 충족하기 위해, 데이터베이스 수준에서 앱 인스턴스를 관리하고 데이터를 격리하는 아키텍처를 채택했습니다.

개발 계획서 생성 완료
파일 위치: 2026-01-28-photo-story-development-plan.md

주요 설계 포인트 요약
멀티 인스턴스 아키텍처

AppInstance 모델을 도입하여 블로그 내에 '가족 사진', '여행 사진' 등 여러 개의 독립된 앱을 설치할 수 있도록 설계했습니다.
각 인스턴스는 고유한 URL 슬러그(/apps/family, /apps/travel)와 독립된 사진/댓글/태그 데이터를 가집니다.
보안 이미지 서빙

"외부 링크 절대 접근 불가" 요건을 충족하기 위해, 이미지 파일에 대한 직접 접근을 차단합니다.
대신 백엔드 API를 통해 권한(그룹 설정)을 확인한 후 이미지를 스트리밍하거나 Nginx 내부 리다이렉트(X-Accel-Redirect)를 사용하는 방식을 제안했습니다.
데이터베이스 모델 확장 (Prisma Schema 제안 포함)

AppInstance: 앱 설정 및 메타데이터 관리.
PhotoPost: 기존 Media 테이블과 연결되며, 각 앱 인스턴스에 종속됨.
PhotoEssay: 사진 위에 표시될 '짧은글'을 위한 전용 모델. 댓글(PhotoComment)과 분리하여 감성적인 UI 표현이 가능하도록 했습니다.
단계별 개발 계획

DB/Backend 기반 구축 -> Admin 관리 기능 -> Frontend 뷰어 -> 소셜 기능(댓글/짧은글) 순으로 진행되는 5단계 계획을 수립했습니다.
이 계획서를 바탕으로 개발을 진행하면 확장성과 요구사항을 모두 만족하는 앱을 구현할 수 있습니다. 추가적인 수정이나 즉시 구현을 원하시면 말씀해 주세요.
