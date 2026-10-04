-- Phase 53: Learning & Academy Pack
-- Course catalog, lessons, enrollments, quizzes, certificates, workshops, ratings, learning paths

CREATE TABLE "Course" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'general',
  "level" TEXT NOT NULL DEFAULT 'beginner',
  "thumbnailUrl" TEXT,
  "instructorId" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "price" DOUBLE PRECISION,
  "durationMin" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Course_tenantId_slug_key" ON "Course"("tenantId", "slug");
CREATE INDEX "Course_tenantId_isPublished_idx" ON "Course"("tenantId", "isPublished");
CREATE INDEX "Course_tenantId_category_idx" ON "Course"("tenantId", "category");
CREATE INDEX "Course_instructorId_idx" ON "Course"("instructorId");

CREATE TABLE "Lesson" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'text',
  "contentUrl" TEXT,
  "body" TEXT,
  "durationMin" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isFree" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Lesson_courseId_sortOrder_idx" ON "Lesson"("courseId", "sortOrder");

CREATE TABLE "enrollments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "progress_pct" INTEGER NOT NULL DEFAULT 0,
  "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "enrollments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "enrollments_tenant_id_course_id_member_id_key" ON "enrollments"("tenant_id", "course_id", "member_id");
CREATE INDEX "enrollments_tenant_id_member_id_idx" ON "enrollments"("tenant_id", "member_id");
CREATE INDEX "enrollments_tenant_id_course_id_idx" ON "enrollments"("tenant_id", "course_id");
CREATE INDEX "enrollments_tenant_id_status_idx" ON "enrollments"("tenant_id", "status");

CREATE TABLE "lesson_progress" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "enrollment_id" TEXT NOT NULL,
  "lesson_id" TEXT NOT NULL,
  "is_done" BOOLEAN NOT NULL DEFAULT false,
  "done_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lesson_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lesson_progress_enrollment_id_lesson_id_key" ON "lesson_progress"("enrollment_id", "lesson_id");
CREATE INDEX "lesson_progress_tenant_id_enrollment_id_idx" ON "lesson_progress"("tenant_id", "enrollment_id");

CREATE TABLE "quizzes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "lesson_id" TEXT NOT NULL,
  "title" TEXT,
  "passing_pct" INTEGER NOT NULL DEFAULT 70,
  "max_attempts" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quizzes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quizzes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "quizzes_lesson_id_key" ON "quizzes"("lesson_id");
CREATE INDEX "quizzes_tenant_id_is_active_idx" ON "quizzes"("tenant_id", "is_active");

CREATE TABLE "quiz_questions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "quiz_id" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'mcq',
  "options" JSONB NOT NULL,
  "correct_index" INTEGER NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quiz_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "quiz_questions_tenant_id_quiz_id_idx" ON "quiz_questions"("tenant_id", "quiz_id");

CREATE TABLE "quiz_attempts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "quiz_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "answers" JSONB NOT NULL,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quiz_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quiz_attempts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "quiz_attempts_tenant_id_quiz_id_idx" ON "quiz_attempts"("tenant_id", "quiz_id");
CREATE INDEX "quiz_attempts_tenant_id_member_id_idx" ON "quiz_attempts"("tenant_id", "member_id");

CREATE TABLE "certificates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pdf_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "certificates_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "certificates_code_key" ON "certificates"("code");
CREATE INDEX "certificates_tenant_id_member_id_idx" ON "certificates"("tenant_id", "member_id");
CREATE INDEX "certificates_tenant_id_course_id_idx" ON "certificates"("tenant_id", "course_id");

CREATE TABLE "workshops" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "courseId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "instructorId" TEXT,
  "scheduledAt" TIMESTAMPTZ NOT NULL,
  "durationMin" INTEGER NOT NULL DEFAULT 60,
  "meetingUrl" TEXT,
  "capacity" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "workshops_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workshops_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "workshops_tenantId_scheduledAt_idx" ON "workshops"("tenantId", "scheduledAt");
CREATE INDEX "workshops_courseId_idx" ON "workshops"("courseId");

CREATE TABLE "workshop_bookings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "workshopId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'booked',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "workshop_bookings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workshop_bookings_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workshop_bookings_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "workshop_bookings_workshopId_memberId_key" ON "workshop_bookings"("workshopId", "memberId");
CREATE INDEX "workshop_bookings_tenantId_workshopId_idx" ON "workshop_bookings"("tenantId", "workshopId");
CREATE INDEX "workshop_bookings_memberId_idx" ON "workshop_bookings"("memberId");

CREATE TABLE "course_ratings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "review" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_ratings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "course_ratings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "course_ratings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "course_ratings_course_id_member_id_key" ON "course_ratings"("course_id", "member_id");
CREATE INDEX "course_ratings_tenant_id_course_id_idx" ON "course_ratings"("tenant_id", "course_id");
CREATE INDEX "course_ratings_tenant_id_member_id_idx" ON "course_ratings"("tenant_id", "member_id");

CREATE TABLE "LearningPath" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "courseIds" JSONB NOT NULL DEFAULT '[]',
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPath_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LearningPath_tenantId_isPublished_idx" ON "LearningPath"("tenantId", "isPublished");
