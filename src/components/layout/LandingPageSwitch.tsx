'use client';

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLandingPage } from "@/context/landing-page-context";

export default function LandingPageSwitch() {
    const { preference, togglePreference, isLandingPageLoading } = useLandingPage();

    if (isLandingPageLoading) {
        return null; // Or a skeleton
    }

    return (
        <div className="flex items-center space-x-2">
            <Switch
                id="landing-page-switch"
                checked={preference === 'original'}
                onCheckedChange={togglePreference}
            />
            <Label htmlFor="landing-page-switch" className="text-xs text-muted-foreground whitespace-nowrap">
                기존 홈을 첫 화면으로
            </Label>
        </div>
    );
}
