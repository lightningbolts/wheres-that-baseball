package config

import (
	"bufio"
	"os"
	"strings"
)

// loadEnvFiles reads KEY=VALUE pairs from .env files without overriding
// variables already set in the process environment.
func loadEnvFiles() {
	for _, path := range []string{
		".env",
		"ingestor/.env",
		"../web/.env.local",
		"web/.env.local",
	} {
		loadEnvFile(path)
	}
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || os.Getenv(key) != "" {
			continue
		}

		value = strings.Trim(value, `"'`)
		os.Setenv(key, value)
	}
}
