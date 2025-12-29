
// This layout file is intentionally left blank.
// It ensures that any child routes, like courses/[courseId]/page.tsx,
// can inherit the main admin layout from the parent directory.
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
