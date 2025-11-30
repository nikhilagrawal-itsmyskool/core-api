
## Service layer guidelines

- There is simple interface to read and write files from file system.
- When reading, it takes filename / filepath and return file contents.
- If file doesen't exist, it throws error.
- While writing, it takes filename / filepath and its contents as string. And write it to file system.
- But while writing to filesystem, it first creates a lock file, if lock file already exists, then it waits for maximum of 2 sec to try taking lock.
- If it is able to take lock, then it replaces existing file with new content or add new file with content if file with same filename / filepath doesn't exist.
- After that it removes the lock.
- If in initial phase it was not able to take lock, then it throws exception.
- The file interface will have two implementation, one for AWS S3 other for local filesystem.

Written in Typescript, nodejs 20.x version.
