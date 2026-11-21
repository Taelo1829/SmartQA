@echo off
REM Local pnpm shim so tooling that shells out to `pnpm` (Prisma, Next) works
REM without a global pnpm install. Uses the bundled Node runtime.
node "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" %*
